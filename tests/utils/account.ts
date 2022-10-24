import algosdk, { Account } from 'algosdk'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { unfreeze } from '../../operations/admin'
import { getAndOptInEscrow } from '../../operations/escrow'
import { invest } from '../../operations/investor'
import { algodClient } from '../../utils/init'
import { optInAsset, optInContract } from '../../utils/opt-in'
import { PendingTxnResponse, transferAsset, waitForTransaction } from '../../utils/transactions'
import { transferAlgos } from '../../utils/transfer-algos'
import { getGenesisAccounts } from '../setup'
import { whitelistInvestor } from './kyc'

export async function payAccount(sender: Account, to: string, amount: number): Promise<PendingTxnResponse> {
  const suggestedParams = await algodClient.getTransactionParams().do()
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: sender.addr,
    to: to,
    amount: amount,
    suggestedParams: suggestedParams,
  })
  const signedTxn = txn.signTxn(sender.sk)

  const tx = await algodClient.sendRawTransaction(signedTxn).do()
  return waitForTransaction(tx.txId)
}

const FUNDING_AMOUNT = 100000000

export async function fundAccount(address: string, amount: number = FUNDING_AMOUNT): Promise<PendingTxnResponse> {
  const fundingAccounts = await getGenesisAccounts()
  const fundingAccount = fundingAccounts[Math.floor(Math.random() * fundingAccounts.length)]
  return payAccount(fundingAccount, address, amount)
}

const accountList = []

export async function getTemporaryAccount(): Promise<Account> {
  if (accountList.length === 0) {
    for (let i = 0; i < 16; i++) {
      accountList.push(algosdk.generateAccount())
    }

    const genesisAccounts = await getGenesisAccounts()
    const suggestedParams = await algodClient.getTransactionParams().do()

    const txns = []
    for (let i = 0; i < accountList.length; i++) {
      const fundingAccount = genesisAccounts[i % genesisAccounts.length]
      txns.push(
        algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: fundingAccount.addr,
          to: accountList[i].addr,
          amount: FUNDING_AMOUNT,
          suggestedParams: suggestedParams,
        }),
      )
    }

    await algosdk.assignGroupID(txns)
    const signedTxns = []
    for (let i = 0; i < txns.length; i++) {
      signedTxns.push(txns[i].signTxn(genesisAccounts[i % genesisAccounts.length].sk))
    }

    const tx = await algodClient.sendRawTransaction(signedTxns).do()

    waitForTransaction(tx.txId)
  }

  return accountList.pop()
}

const startingUsdc =
  (2 * getConfigNumber('MAXIMUM_LOAN_VALUE') * getConfigNumber('USDC_DECIMAL_SCALE')) /
  getConfigNumber('USD_CENTS_SCALE')

export async function createAndOptInInvestor(usdcCreatorAccount: Account, usdcId: number, numUsdc = startingUsdc) {
  const investorAccount = await getTemporaryAccount()
  await optInAsset(investorAccount, usdcId)
  await transferAsset(usdcCreatorAccount, investorAccount.addr, usdcId, numUsdc)
  return investorAccount
}

export async function createAndOptInBorrower(usdcId: number, appId: number, minterId: number) {
  const borrower = await getTemporaryAccount()
  await optInAsset(borrower, usdcId)
  await optInContract(borrower, appId)
  await optInContract(borrower, minterId)
  return borrower
}

export interface CreateInvestorAndEscrowParams {
  admin: Account
  creator: Account
  usdcId: number
  appId: number
  idTokenId: number
  initialInvestment?: number
  initialAlgos?: number
}

export async function createInvestorAndEscrow(params: CreateInvestorAndEscrowParams) {
  const investorUsdc = params.initialInvestment || startingUsdc
  const escrowAlgos = params.initialAlgos || getConfigNumber('INVESTOR_ESCROW_INITIAL_BALANCE')
  const investor = await createAndOptInInvestor(params.creator, params.usdcId, investorUsdc)
  const escrow = await getAndOptInEscrow(investor, params.appId)
  await whitelistInvestor(investor, params.creator, params.idTokenId)
  await transferAlgos(investor, escrow.address(), escrowAlgos)
  await invest(investor, params.appId, investorUsdc)
  await unfreeze(params.admin, investor.addr, params.appId)
  return { investor, escrow }
}
