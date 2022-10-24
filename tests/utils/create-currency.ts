import algosdk, { Account } from 'algosdk'
import { algodClient } from '../../utils/init'
import { waitForTransaction } from '../../utils/transactions'

let firstAsset = true

interface CurrencyAssetParams {
  name: string
  unitName: string
  decimals: number
  total?: number
}

export async function createCurrencyAsset(
  creator: Account,
  { name, unitName, decimals, total = Number.MAX_SAFE_INTEGER }: CurrencyAssetParams,
): Promise<number> {
  const suggestedParams = await algodClient.getTransactionParams().do()
  const note = undefined
  const defaultFrozen = false
  const assetName = name
  const assetURL = 'http://someurl'
  const assetMetadataHash = '16efaa3924a6fd9d3a4824799a4ac65d'
  const manager = undefined
  const reserve = undefined
  const freeze = undefined
  const clawback = undefined
  // signing and sending "txn" allows "addr" to create an asset
  const txn = await algosdk.makeAssetCreateTxnWithSuggestedParams(
    creator.addr,
    note,
    total,
    decimals,
    defaultFrozen,
    manager,
    reserve,
    freeze,
    clawback,
    unitName,
    assetName,
    assetURL,
    assetMetadataHash,
    suggestedParams,
  )

  const signedTxn = txn.signTxn(creator.sk)
  const txId = txn.txID().toString()
  await algodClient.sendRawTransaction(signedTxn).do()

  await waitForTransaction(txId)
  const ptx = await algodClient.pendingTransactionInformation(txId).do()
  return ptx['asset-index']
}

export async function safeCreateCurrencyAsset(
  creator: Account,
  name: string,
  decimals: number,
  total = Number.MAX_SAFE_INTEGER,
): Promise<number> {
  // ATTN Asset with ID 0 has odd behavior, so make sure this ID is not used
  if (firstAsset) {
    await createCurrencyAsset(creator, { name: 'DUMMY', unitName: 'DUMMY', decimals: 0 })
    firstAsset = false
  }
  return await createCurrencyAsset(creator, { name: name, unitName: name, decimals, total })
}
