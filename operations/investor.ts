import algosdk, { Account, LogicSigAccount } from 'algosdk'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { getEscrow } from './escrow'
import { transferAsset, waitForTransaction } from '../utils/transactions'
import { algodClient } from '../utils/init'
import { createTransferAssetTxn } from '../utils/transactions'
import { getAppTokenIds } from '../utils/matching-helpers'
import { getGlobalStateValue } from '../utils/state'

export async function invest(investor: Account, appId: number, amount: number): Promise<void> {
  const escrow = await getEscrow(investor.addr, appId)
  const tokens = await getAppTokenIds(appId)
  await transferAsset(investor, escrow.address(), tokens.currencyId, amount)
}

export async function withdraw(investor: Account, appId: number, amount: number): Promise<void> {
  const escrow = await getEscrow(investor.addr, appId)
  const params = await algodClient.getTransactionParams().do()
  params.flatFee = true
  params.fee = 0
  const tokens = await getAppTokenIds(appId)
  const transferTxn = await createTransferAssetTxn({
    fromAddress: escrow.address(),
    toAddress: investor.addr,
    assetId: tokens.currencyId,
    amount,
    params,
  })
  // Group with a payment transaction to cover the fees
  params.fee = getConfigNumber('WITHDRAW_FEE')
  const withdrawTxn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: investor.addr,
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('withdraw'))],
    foreignAssets: [tokens.currencyId, tokens.bidId, tokens.accessId],
    accounts: [escrow.address()],
  })
  algosdk.assignGroupID([transferTxn, withdrawTxn])
  const signedTransferTxn = algosdk.signLogicSigTransaction(transferTxn, escrow)
  const signedWithdrawTxn = withdrawTxn.signTxn(investor.sk)
  const tx = await algodClient.sendRawTransaction([signedTransferTxn.blob, signedWithdrawTxn]).do()
  await waitForTransaction(tx.txId)
}

export async function freeze(investor: Account, appId: number, escrow?: LogicSigAccount): Promise<void> {
  if (!escrow) {
    escrow = await getEscrow(investor.addr, appId)
  }
  const tokens = await getAppTokenIds(appId)
  const params = await algodClient.getTransactionParams().do()
  params.flatFee = true
  params.fee = 0
  const appAddress = await algosdk.getApplicationAddress(appId)

  // Transfer bidding token to app
  const bidAssetTxn = await createTransferAssetTxn({
    fromAddress: escrow.address(),
    toAddress: appAddress,
    assetId: tokens.bidId,
    amount: 1,
    params,
  })

  // Transfer access token to app
  const accessAssetTxn = await createTransferAssetTxn({
    fromAddress: escrow.address(),
    toAddress: appAddress,
    assetId: tokens.accessId,
    amount: 1,
    params,
  })

  // Investor calls freeze function in matching app
  const idTokenId = (await getGlobalStateValue({ appId, key: 'identity_token_id' })) as number
  params.fee = getConfigNumber('FREEZE_FEE')
  const freezeTxn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: investor.addr,
    suggestedParams: params,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('freeze'))],
    foreignAssets: [idTokenId],
  })

  algosdk.assignGroupID([bidAssetTxn, accessAssetTxn, freezeTxn])
  const signedBidAssetTxn = algosdk.signLogicSigTransaction(bidAssetTxn, escrow)
  const signedAccessAssetTxn = algosdk.signLogicSigTransaction(accessAssetTxn, escrow)
  const signedFreezeTxn = freezeTxn.signTxn(investor.sk)
  const tx = await algodClient
    .sendRawTransaction([signedBidAssetTxn.blob, signedAccessAssetTxn.blob, signedFreezeTxn])
    .do()
  await waitForTransaction(tx.txId)
}
