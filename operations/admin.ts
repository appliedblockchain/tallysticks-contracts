import algosdk, { Account } from 'algosdk'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { getEscrow } from './escrow'
import { createTransferAssetTxn, waitForTransaction } from '../utils/transactions'
import { algodClient } from '../utils/init'
import { calculateInvoicePrice, getAppTokenIds } from '../utils/matching-helpers'
import { getGlobalStateValue } from '../utils/state'
import { createOptInAssetTxn } from '../utils/opt-in'
import { getAssetsInWallet } from '../utils/assets'

export async function unfreeze(admin: Account, investorAddress: string, appId: number): Promise<string> {
  const escrow = await getEscrow(investorAddress, appId)
  const tokens = await getAppTokenIds(appId)
  const params = await algodClient.getTransactionParams().do()

  // Opt in to bidding token
  params.flatFee = true
  params.fee = getConfigNumber('UNFREEZE_FEE') // Pay for all transactions in this group
  const bidAssetTxn = await createOptInAssetTxn(escrow.address(), tokens.bidId, params)

  // Opt in to access token
  params.fee = 0
  const accessAssetTxn = await createOptInAssetTxn(escrow.address(), tokens.accessId, params)

  // Admin calls the unfreeze function in matching application
  const MINIMUM_LOAN_VALUE = getConfigNumber('MINIMUM_LOAN_VALUE')
  const idTokenId = (await getGlobalStateValue({ appId, key: 'identity_token_id' })) as number
  const unfreezeTxn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: admin.addr,
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('unfreeze')), algosdk.encodeUint64(MINIMUM_LOAN_VALUE)],
    foreignAssets: [tokens.currencyId, tokens.bidId, tokens.accessId, idTokenId],
    accounts: [investorAddress, escrow.address()],
  })

  algosdk.assignGroupID([bidAssetTxn, accessAssetTxn, unfreezeTxn])
  const signedBidAssetTxn = algosdk.signLogicSigTransaction(bidAssetTxn, escrow)
  const signedAccessAssetTxn = algosdk.signLogicSigTransaction(accessAssetTxn, escrow)
  const signedUnfreezeTxn = unfreezeTxn.signTxn(admin.sk)
  const tx = await algodClient
    .sendRawTransaction([signedBidAssetTxn.blob, signedAccessAssetTxn.blob, signedUnfreezeTxn])
    .do()

  await waitForTransaction(tx.txId)

  return tx.txId
}

export async function action(admin: Account, investorAddress: string, appId: number, price?: number): Promise<string> {
  const escrow = await getEscrow(investorAddress, appId)
  const tokens = await getAppTokenIds(appId)
  const params = await algodClient.getTransactionParams().do()

  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const minterAddress = algosdk.getApplicationAddress(minterId)

  // Opt in to ownership token
  params.flatFee = true
  params.fee = getConfigNumber('ACTION_FEE') // Pay for all transactions in this group
  const invoiceAddress = algosdk.encodeAddress(
    (await getGlobalStateValue({ appId, key: 'invoice_address', decodeValue: false })) as Buffer,
  )
  const minterAssets = await getAssetsInWallet(invoiceAddress, { creatorAddress: minterAddress, unitName: 'SD-OWN' })
  if (minterAssets.length !== 1) {
    throw new Error('Incorrect number of assets in invoice smart signature')
  }
  const ownTokenId = minterAssets[0]['asset-id']
  const ownAssetTxn = await createOptInAssetTxn(escrow.address(), ownTokenId, params)

  // Transfer currency to borrower
  params.fee = 0
  const borrowerAddress = algosdk.encodeAddress(
    (await getGlobalStateValue({ appId, key: 'owner_address', decodeValue: false })) as Buffer,
  )
  const invoicePrice = await calculateInvoicePrice(appId, invoiceAddress)
  const loanTxn = await createTransferAssetTxn({
    fromAddress: escrow.address(),
    toAddress: borrowerAddress,
    assetId: tokens.currencyId,
    amount: price || invoicePrice,
    params,
  })

  // Admin calls the action function in matching application
  const actionTxn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: admin.addr,
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('action'))],
    foreignAssets: [tokens.currencyId, tokens.bidId, ownTokenId],
    accounts: [invoiceAddress, escrow.address(), borrowerAddress],
    foreignApps: [minterId],
  })

  algosdk.assignGroupID([ownAssetTxn, loanTxn, actionTxn])
  const signedOwnAssetTxn = algosdk.signLogicSigTransaction(ownAssetTxn, escrow)
  const signedLoanTxn = algosdk.signLogicSigTransaction(loanTxn, escrow)
  const signedActionTxn = actionTxn.signTxn(admin.sk)
  const tx = await algodClient.sendRawTransaction([signedOwnAssetTxn.blob, signedLoanTxn.blob, signedActionTxn]).do()

  await waitForTransaction(tx.txId)

  return signedLoanTxn.txID
}

export async function reset(admin: Account, appId: number): Promise<void> {
  const tokens = await getAppTokenIds(appId)
  const params = await algodClient.getTransactionParams().do()
  params.flatFee = true
  params.fee = getConfigNumber('RESET_FEE')

  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const minterAddress = algosdk.getApplicationAddress(minterId)
  const invoiceAddress = algosdk.encodeAddress(
    (await getGlobalStateValue({ appId, key: 'invoice_address', decodeValue: false })) as Buffer,
  )
  const minterAssets = await getAssetsInWallet(invoiceAddress, { creatorAddress: minterAddress, unitName: 'SD-OWN' })
  if (minterAssets.length !== 1) {
    throw new Error('Incorrect number of assets in invoice smart signature')
  }
  const ownTokenId = minterAssets[0]['asset-id']
  const borrowerAddress = algosdk.encodeAddress(
    (await getGlobalStateValue({ appId, key: 'owner_address', decodeValue: false })) as Buffer,
  )
  const resetTxn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: admin.addr,
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('reset'))],
    foreignAssets: [ownTokenId, tokens.bidId, tokens.accessId],
    accounts: [invoiceAddress, borrowerAddress],
    foreignApps: [minterId],
  })

  const signedResetTxn = resetTxn.signTxn(admin.sk)
  const tx = await algodClient.sendRawTransaction([signedResetTxn]).do()

  await waitForTransaction(tx.txId)
}

export async function setBidTimeLimit(admin: Account, appId: number, bidTimeLimit: number): Promise<void> {
  const params = await algodClient.getTransactionParams().do()

  const txn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: admin.addr,
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('set_bid_time_limit')), algosdk.encodeUint64(bidTimeLimit)],
  })

  const signedTxn = txn.signTxn(admin.sk)
  const tx = await algodClient.sendRawTransaction([signedTxn]).do()

  await waitForTransaction(tx.txId)
}
