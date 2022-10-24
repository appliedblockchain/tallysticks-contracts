import algosdk, { Account } from 'algosdk'
import { getConfigNumber, getConfig } from '@appliedblockchain/tallysticks-contract-config'
import { fullyCompileContractFromFile } from '../utils/compile'
import { waitForTransaction } from '../utils/transactions'
import { algodClient } from '../utils/init'

export async function getContracts(): Promise<{ approval: Uint8Array; clearState: Uint8Array }> {
  const { program: approval } = await fullyCompileContractFromFile('matching-approval.teal')
  const { program: clearState } = await fullyCompileContractFromFile('matching-clear.teal')

  return { approval, clearState }
}

export interface CreateMatchingAppParams {
  sender: Account
  identityTokenId: number
  minterId: number
  bidTimeLimit?: number
  maxBidFees?: number
}

export async function createMatchingApp({
  sender,
  identityTokenId,
  minterId,
  bidTimeLimit = getConfigNumber('BID_TIME_LIMIT'),
  maxBidFees = getConfigNumber('MAX_BIDDING_FEES'),
}: CreateMatchingAppParams): Promise<number> {
  const { approval, clearState } = await getContracts()

  const { GLOBAL_BYTE_SLICES, GLOBAL_INTS, LOCAL_BYTE_SLICES, LOCAL_INTS } = getConfig('MATCHING_APP_STATE')
  const suggestedParams = await algodClient.getTransactionParams().do()
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    from: sender.addr,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    approvalProgram: approval,
    clearProgram: clearState,
    numGlobalByteSlices: GLOBAL_BYTE_SLICES,
    numGlobalInts: GLOBAL_INTS,
    numLocalByteSlices: LOCAL_BYTE_SLICES,
    numLocalInts: LOCAL_INTS,
    appArgs: [
      algosdk.encodeUint64(identityTokenId),
      algosdk.encodeUint64(minterId),
      algosdk.encodeUint64(bidTimeLimit),
      algosdk.encodeUint64(maxBidFees),
    ],
    suggestedParams: suggestedParams,
  })

  const signedTxn = txn.signTxn(sender.sk)

  const tx = await algodClient.sendRawTransaction(signedTxn).do()

  const response = await waitForTransaction(tx.txId)
  if (!response.applicationIndex || response.applicationIndex === 0) {
    throw Error('Invalid response')
  }

  return response.applicationIndex
}

export async function setupMatchingApp(sender: Account, appId: number, currencyId: number): Promise<void> {
  const MATCHING_APP_MINIMUM_BALANCE = getConfigNumber('MATCHING_APP_MINIMUM_BALANCE')
  const MINIMUM_TRANSACTION_FEE = getConfigNumber('MINIMUM_TRANSACTION_FEE')
  // Matching app must pay for transactions to opt in to currency and create bidding and access tokens
  const balance = MATCHING_APP_MINIMUM_BALANCE + 3 * MINIMUM_TRANSACTION_FEE

  const suggestedParams = await algodClient.getTransactionParams().do()
  const appAddress = await algosdk.getApplicationAddress(appId)

  const fundAppTxn = await algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: sender.addr,
    to: appAddress,
    amount: balance,
    suggestedParams: suggestedParams,
  })

  const setupTxn = await algosdk.makeApplicationNoOpTxnFromObject({
    from: sender.addr,
    suggestedParams: suggestedParams,
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from('setup'))],
    foreignAssets: [currencyId],
  })

  algosdk.assignGroupID([fundAppTxn, setupTxn])
  const signedFundAppTxn = fundAppTxn.signTxn(sender.sk)
  const signedSetupTxn = setupTxn.signTxn(sender.sk)
  const tx = await algodClient.sendRawTransaction([signedFundAppTxn, signedSetupTxn]).do()
  await waitForTransaction(tx.txId)
}

export interface DeployMatchingAppParams {
  sender: Account
  identityTokenId: number
  minterId: number
  currencyId: number
  bidTimeLimit?: number
  maxBidFees?: number
}

export async function deployMatchingApp(params: DeployMatchingAppParams): Promise<number> {
  const { currencyId, ...createMatchingAppParams } = params
  const appId = await createMatchingApp(createMatchingAppParams)
  await setupMatchingApp(params.sender, appId, currencyId)
  return appId
}
