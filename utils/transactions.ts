import { algodClient } from './init'
import algosdk, { Account, LogicSigAccount, SuggestedParams, Transaction } from 'algosdk'

export class PendingTxnResponse {
  poolError: string
  txn: any
  applicationIndex?: number
  assetIndex?: number
  closeRewards?: number
  closingAmount?: number
  confirmedRound?: number
  globalStateDelta?: any
  localStateDelta?: any
  receiverRewards?: number
  senderRewards?: number
  innerTxns: any[]

  constructor(response: Record<string, any>) {
    this.poolError = response['pool-error']
    this.txn = response['txn']

    this.applicationIndex = response['application-index']
    this.assetIndex = response['asset-index']
    this.closeRewards = response['close-rewards']
    this.closingAmount = response['closing-amount']
    this.confirmedRound = response['confirmed-round']
    this.globalStateDelta = response['global-state-delta']
    this.localStateDelta = response['local-state-delta']
    this.receiverRewards = response['receiver-rewards']
    this.senderRewards = response['sender-rewards']

    this.innerTxns = response['inner-txns']
  }
}

const wait = (ms) => new Promise((res) => setTimeout(res, ms))

export async function waitForTransaction(txID: string, timeout = 10): Promise<PendingTxnResponse> {
  let lastStatus = await algodClient.status().do()
  let lastRound = lastStatus['last-round']
  const startRound = lastRound

  while (lastRound < startRound + timeout) {
    let pending_txn
    let attempts = 0
    while (attempts < 5) {
      try {
        pending_txn = await algodClient.pendingTransactionInformation(txID).do()
        break
      } catch (e) {
        const errorMsg = e.response?.body?.message
        console.log(errorMsg || e)
        await wait(1000 * (attempts + 1))
        attempts += 1
      }
    }

    if (pending_txn['confirmed-round'] > 0) {
      return new PendingTxnResponse(pending_txn)
    }

    if (pending_txn['pool-error']) {
      throw Error('Pool error: ' + pending_txn['pool-error'])
    }

    lastStatus = await algodClient.statusAfterBlock(lastRound + 1).do()

    lastRound += 1
  }

  throw Error(`Transaction ${txID} not confirmed after ${timeout} rounds`)
}

export async function transferAsset(sender: Account, toAddress: string, assetId: number, value = 1): Promise<string> {
  const params = await algodClient.getTransactionParams().do()

  const txn = await createTransferAssetTxn({ fromAddress: sender.addr, toAddress, assetId, amount: value, params })

  const signedTxn = txn.signTxn(sender.sk)
  const txId = txn.txID().toString()

  await algodClient.sendRawTransaction(signedTxn).do()

  await waitForTransaction(txId)

  return txId
}

export interface CreateTransferAssetTxnParams {
  fromAddress: string
  toAddress: string
  assetId: number
  amount: number
  closeRemainderTo?: string
  params: SuggestedParams
  overrides?: any
}

export async function createTransferAssetTxn({
  fromAddress,
  toAddress,
  assetId,
  amount,
  closeRemainderTo,
  params,
  overrides = {},
}: CreateTransferAssetTxnParams): Promise<Transaction> {
  const txnObj = {
    from: fromAddress,
    to: toAddress,
    assetIndex: assetId,
    amount,
    closeRemainderTo,
    suggestedParams: {
      ...params,
    },
  }

  Object.keys(overrides).forEach((k) => {
    txnObj[k] = overrides[k]
  })

  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject(txnObj)
}

export async function signAndSendLsigTxn(lsig: LogicSigAccount, txn: Transaction): Promise<void> {
  const rawSignedTxn = algosdk.signLogicSigTransactionObject(txn, lsig)
  await algodClient.sendRawTransaction(rawSignedTxn.blob).do()
  await waitForTransaction(txn.txID().toString())
}

export const sendAndWaitTxnConfirmation = async (
  signedTxn: Uint8Array | Uint8Array[],
  txId: string,
  waitRounds = 5,
): Promise<void> => {
  await algodClient.sendRawTransaction(signedTxn).do()
  await algosdk.waitForConfirmation(algodClient, txId, waitRounds)
}
