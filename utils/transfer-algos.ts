import algosdk, { Account, Transaction } from 'algosdk'
import { algodClient } from './init'
import { waitForTransaction } from './transactions'

export async function transferAlgos(from: Account, toAddr: string, value: number, overrides = {}): Promise<string> {
  const txn = await addFundsToAccount(from.addr, toAddr, value, overrides)

  const signedTxn = txn.signTxn(from.sk)
  const txId = txn.txID().toString()

  await algodClient.sendRawTransaction(signedTxn).do()

  await waitForTransaction(txId)

  return txId
}

async function addFundsToAccount(
  fromAddress: string,
  toAddress: string,
  value: number,
  overrides = {},
): Promise<Transaction> {
  const params = await algodClient.getTransactionParams().do()

  const txnObj = {
    from: fromAddress,
    to: toAddress,
    suggestedParams: {
      ...params,
    },
    amount: value,
  }

  Object.keys(overrides).forEach((k) => {
    txnObj[k] = overrides[k]
  })

  const txn = await algosdk.makePaymentTxnWithSuggestedParamsFromObject(txnObj)

  return txn
}
