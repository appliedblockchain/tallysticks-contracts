import algosdk, { Account, SuggestedParams, Transaction } from 'algosdk'
import { algodClient } from './init'
import { waitForTransaction, transferAsset, createTransferAssetTxn } from './transactions'

export async function optInContract(sender: Account, appId: number): Promise<any> {
  const suggestedParams = await algodClient.getTransactionParams().do()
  const txn = await algosdk.makeApplicationOptInTxn(sender.addr, suggestedParams, appId)

  const signedTxn = txn.signTxn(sender.sk)
  const txId = txn.txID().toString()

  const xtx = await algodClient.sendRawTransaction(signedTxn).do()

  await waitForTransaction(txId)
  return xtx
}

export async function optInAsset(sender: Account, assetId: number): Promise<any> {
  return await transferAsset(sender, sender.addr, assetId, 0)
}

export async function createOptInAssetTxn(
  senderAddress: string,
  assetId: number,
  params?: SuggestedParams,
): Promise<Transaction> {
  let suggestedParams = params
  if (!suggestedParams) {
    suggestedParams = await algodClient.getTransactionParams().do()
  }
  return await createTransferAssetTxn({
    fromAddress: senderAddress,
    toAddress: senderAddress,
    assetId,
    amount: 0,
    params: suggestedParams,
  })
}
