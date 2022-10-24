import algosdk, { Account, LogicSigAccount } from 'algosdk'
import config from 'config'
import cbor from 'cbor'
import nacl from 'tweetnacl'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import {
  createTestMintApp,
  ProofCertificateSchema,
  mintAsset,
  claimAsset,
  getAssetLogicSigAccount,
  optAssetLogicSigAccountIntoOwnAsset,
} from '@appliedblockchain/silentdata-mint'
import crypto from 'crypto'
import { getCurrentTimestamp } from './timestamp'

export async function createDummyMintingApplication(
  sender: Account,
): Promise<{ appId: number; programHash: Uint8Array; enclaveKeys: nacl.SignKeyPair }> {
  const schema: ProofCertificateSchema = {
    check_hash: 'byte-slice',
    id: 'byte-slice',
    lsig_pkey: 'byte-slice',
    initiator_pkey: 'byte-slice',
    asset_id: 'byte-slice',
    timestamp: 'int',
    risk_score: 'int',
    value: 'int',
    currency_code: 'byte-slice',
    interest_rate: 'int',
    funding_date: 'int',
    due_date: 'int',
  }
  const { appId, programHash, enclaveKeys } = await createTestMintApp({ creator: sender, schema })
  return { appId, programHash, enclaveKeys }
}

function isAccount(obj: any): obj is Account {
  return obj.addr !== undefined
}

export interface InvoiceParams {
  value: number
  currency_code: string
  due_date: number
  interest_rate: number
  risk_score: number
  funding_date: number
}

export const defaultInvoiceParams: InvoiceParams = {
  value: getConfigNumber('MINIMUM_LOAN_VALUE'),
  currency_code: 'USD',
  due_date:
    getCurrentTimestamp() +
    Math.floor((getConfigNumber('MINIMUM_LOAN_TERM') + getConfigNumber('MAXIMUM_LOAN_TERM')) / 2),
  interest_rate: getConfigNumber('MINIMUM_LOAN_INTEREST'),
  risk_score: Math.floor((1 + getConfigNumber('MAXIMUM_LOAN_RISK')) / 2),
  funding_date: getCurrentTimestamp(),
}

interface MintParams {
  sender: Account | LogicSigAccount
  appId: number
  invoiceParams?: InvoiceParams
  assetId?: Uint8Array
  enclaveKeys: nacl.SignKeyPair
  programHash: Uint8Array
}

export async function dummyMint({
  sender,
  appId,
  invoiceParams = defaultInvoiceParams,
  assetId = crypto.randomBytes(32),
  enclaveKeys,
  programHash,
}: MintParams): Promise<Uint8Array> {
  const senderAddress = isAccount(sender) ? sender.addr : sender.address()
  const asset = await getAssetLogicSigAccount(assetId, appId)
  const certificateData = {
    check_hash: Uint8Array.from(Buffer.from(config.get('INVOICE_CHECK_HASH'), 'hex')),
    id: '123e4567-e89b-12d3-a456-426614174000',
    lsig_pkey: new Uint8Array(algosdk.decodeAddress(asset.address()).publicKey),
    initiator_pkey: new Uint8Array(algosdk.decodeAddress(senderAddress).publicKey),
    asset_id: new Uint8Array(assetId),
    timestamp: getCurrentTimestamp(),
    ...invoiceParams,
  }
  const certificateDataCBOR = new Uint8Array(cbor.encode(certificateData))
  const toSign = Buffer.concat([Buffer.from('ProgData'), Buffer.from(programHash), Buffer.from(certificateDataCBOR)])
  const signature = new Uint8Array(nacl.sign.detached(toSign, enclaveKeys.secretKey))
  await mintAsset(appId, sender, signature, certificateDataCBOR, asset)

  return assetId
}

export async function dummyClaim(
  sender: Account | LogicSigAccount,
  appId: number,
  assetId: Uint8Array,
): Promise<LogicSigAccount> {
  const asset = await getAssetLogicSigAccount(assetId, appId)
  try {
    await optAssetLogicSigAccountIntoOwnAsset(asset, appId, sender)
  } catch (e) {
    console.log(e)
  }
  await claimAsset(appId, sender, asset)
  return asset
}

export async function dummyMintAndClaim({
  sender,
  appId,
  invoiceParams = defaultInvoiceParams,
  assetId = crypto.randomBytes(32),
  enclaveKeys,
  programHash,
}: MintParams): Promise<LogicSigAccount> {
  await dummyMint({ sender, appId, invoiceParams, assetId, enclaveKeys, programHash })
  return await dummyClaim(sender, appId, assetId)
}
