import algosdk, { LogicSigAccount } from 'algosdk'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { algodClient } from '../../utils/init'
import { calculateInvoicePrice, getAppTokenState } from '../../utils/matching-helpers'
import { getBalances, getGlobalStateValue, getLocalStateValue, hasGlobalStateValue } from '../../utils/state'

export interface MatchingStateParams {
  appId: number
  adminAddress?: string
  investorAddress?: string
  investorEscrowAddress?: string
  borrowerAddress?: string
  borrowerEscrowAddress?: string
}

export async function getMatchingAppState({
  appId,
  adminAddress,
  investorAddress,
  investorEscrowAddress,
  borrowerAddress,
  borrowerEscrowAddress,
}: MatchingStateParams): Promise<Record<string, any>> {
  const appAddress = algosdk.getApplicationAddress(appId)
  const app = await getAppTokenState(appAddress)
  let admin = undefined
  if (adminAddress) {
    const adminInfo = await algodClient.accountInformation(adminAddress).do()
    admin = { algo: adminInfo.amount }
  }
  const investor = investorAddress ? await getAppTokenState(investorAddress) : undefined
  const investorEscrow = investorEscrowAddress ? await getAppTokenState(investorEscrowAddress) : undefined
  const borrower = borrowerAddress ? await getAppTokenState(borrowerAddress) : undefined
  const borrowerEscrow = borrowerEscrowAddress ? await getAppTokenState(borrowerEscrowAddress) : undefined
  return { app, admin, investor, investorEscrow, borrower, borrowerEscrow }
}

export function calculateCost(startState: Record<string, any>, endState: Record<string, any>): Record<string, number> {
  return {
    app: startState.app.algo - endState.app.algo,
    admin: startState.admin ? startState.admin.algo - endState.admin.algo : 0,
    investor: startState.investor ? startState.investor.algo - endState.investor.algo : 0,
    investorEscrow: startState.investorEscrow ? startState.investorEscrow.algo - endState.investorEscrow.algo : 0,
    borrower: startState.borrower ? startState.borrower.algo - endState.borrower.algo : 0,
    borrowerEscrow: startState.borrowerEscrow ? startState.borrowerEscrow.algo - endState.borrowerEscrow.algo : 0,
  }
}

export function verifyInvest(startState: Record<string, any>, endState: Record<string, any>, investment: number): void {
  expect(endState.investor.usdc).toBe(startState.investor.usdc - investment)
  expect(endState.investorEscrow.usdc).toBe(startState.investorEscrow.usdc + investment)
  expect(endState.app.algo).toBeGreaterThanOrEqual(startState.app.algo)
  expect(endState.investorEscrow.algo).toBeGreaterThanOrEqual(startState.investorEscrow.algo)
}

export function verifyBorrowerInvest(
  startState: Record<string, any>,
  endState: Record<string, any>,
  investment: number,
): void {
  expect(endState.borrower.usdc).toBe(startState.borrower.usdc - investment)
  expect(endState.borrowerEscrow.usdc).toBe(startState.borrowerEscrow.usdc + investment)
  expect(endState.app.algo).toBeGreaterThanOrEqual(startState.app.algo)
  expect(endState.borrowerEscrow.algo).toBeGreaterThanOrEqual(startState.borrowerEscrow.algo)
}

export function verifyWithdraw(
  startState: Record<string, any>,
  endState: Record<string, any>,
  withdrawal: number,
): void {
  expect(endState.investor.usdc).toBe(startState.investor.usdc + withdrawal)
  expect(endState.investorEscrow.usdc).toBe(startState.investorEscrow.usdc - withdrawal)
  expect(endState.app.algo).toBeGreaterThanOrEqual(startState.app.algo)
  expect(endState.investorEscrow.algo).toBeGreaterThanOrEqual(startState.investorEscrow.algo)
}

export function verifyFreeze(startState: Record<string, any>, endState: Record<string, any>): void {
  expect(endState.investorEscrow.bid).toBe(startState.investorEscrow.bid - 1)
  expect(endState.investorEscrow.access).toBe(startState.investorEscrow.access - 1)
  expect(endState.investorEscrow.algo).toBeGreaterThanOrEqual(startState.investorEscrow.algo)
  expect(endState.app.bid).toBe(startState.app.bid + 1)
  expect(endState.app.access).toBe(startState.app.access + 1)
  expect(endState.app.algo).toBeGreaterThanOrEqual(startState.app.algo)
}

export function verifyUnfreeze(startState: Record<string, any>, endState: Record<string, any>): void {
  expect(endState.investorEscrow.bid).toBe(startState.investorEscrow.bid + 1)
  expect(endState.investorEscrow.access).toBe(startState.investorEscrow.access + 1)
  expect(endState.admin.algo).toBeGreaterThanOrEqual(startState.admin.algo)
  expect(endState.app.bid).toBe(startState.app.bid - 1)
  expect(endState.app.access).toBe(startState.app.access - 1)
  expect(endState.app.algo).toBeGreaterThanOrEqual(startState.app.algo)
}

export function verifyBid(startState: Record<string, any>, endState: Record<string, any>): void {
  expect(endState.investorEscrow.bid).toBe(startState.investorEscrow.bid - 1)
  expect(endState.admin.algo).toBeGreaterThanOrEqual(startState.admin.algo)
  expect(endState.app.bid).toBe(startState.app.bid + 1)
  expect(endState.app.algo).toBeGreaterThanOrEqual(startState.app.algo)
}

export function verifyReset(startState: Record<string, any>, endState: Record<string, any>): void {
  expect(endState.admin.algo).toBeLessThan(startState.admin.algo)
  expect(endState.borrower.algo).toBeGreaterThanOrEqual(startState.borrower.algo)
  expect(endState.app.algo).toBeGreaterThanOrEqual(startState.app.algo)
}

export function verifyVerify(startState: Record<string, any>, endState: Record<string, any>): void {
  expect(endState.borrower.algo).toBeGreaterThanOrEqual(startState.borrower.algo)
  expect(endState.borrowerEscrow.algo).toBeLessThan(startState.borrowerEscrow.algo)
  expect(endState.app.algo).toBeGreaterThanOrEqual(startState.app.algo)
}

export async function verifyReclaim(
  startState: Record<string, any>,
  endState: Record<string, any>,
  escrow: LogicSigAccount,
): Promise<void> {
  const info = await algodClient.accountInformation(escrow.address()).do()
  const minAlgos = getConfigNumber('RECLAIM_FEE') + getConfigNumber('MAX_BIDDING_FEES')
  if (info.amount - info['min-balance'] < minAlgos) {
    expect(endState.investorEscrow.bid).toBe(startState.investorEscrow.bid - 1)
    expect(endState.investorEscrow.access).toBe(startState.investorEscrow.access - 1)
    expect(endState.app.bid).toBe(startState.app.bid + 1)
    expect(endState.app.access).toBe(startState.app.access + 1)
  } else {
    expect(endState.investorEscrow.bid).toBe(startState.investorEscrow.bid + 1)
    expect(endState.investorEscrow.access).toBe(startState.investorEscrow.access)
    expect(endState.app.bid).toBe(startState.app.bid - 1)
    expect(endState.app.access).toBe(startState.app.access)
  }
  expect(endState.admin.algo).toBeGreaterThanOrEqual(startState.admin.algo)
  expect(endState.app.algo).toBeGreaterThanOrEqual(startState.app.algo)
}

export interface VerifyActionParams {
  startState: Record<string, any>
  endState: Record<string, any>
  appId: number
  invoice: LogicSigAccount
  escrow: LogicSigAccount
  borrowerAddress: string
}

export async function verifyAction(params: VerifyActionParams): Promise<void> {
  const { startState, endState, appId, invoice, escrow, borrowerAddress } = params
  const expectedPrice = await calculateInvoicePrice(appId, invoice.address())
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  // Check investor escrow holds ownership token
  const ownTokenId = (await getLocalStateValue({
    address: invoice.address(),
    appId: minterId,
    key: 'asa_id',
  })) as number
  const escrowBalances = await getBalances(escrow.address())
  expect(escrowBalances[ownTokenId]).toBe(1)
  const borrowerBalances = await getBalances(borrowerAddress)
  expect(borrowerBalances[ownTokenId]).toBe(0)

  // Check amount investor escrow has paid
  expect(startState.investorEscrow.usdc - endState.investorEscrow.usdc).toBe(expectedPrice)
  expect(endState.borrower.usdc - startState.borrower.usdc).toBe(expectedPrice)

  // Check the global state of the matching app
  expect(await hasGlobalStateValue(appId, 'owner_address')).toBe(false)
  expect(await hasGlobalStateValue(appId, 'escrow_address')).toBe(false)
  expect(await hasGlobalStateValue(appId, 'invoice_address')).toBe(false)
  expect(await hasGlobalStateValue(appId, 'leading_timestamp')).toBe(false)

  // Check that the address of the borrower is written to invoice
  const debtorAddress = (await getLocalStateValue({
    address: invoice.address(),
    appId,
    key: 'debtor_address',
    decodeValue: false,
  })) as Buffer
  expect(algosdk.encodeAddress(debtorAddress)).toBe(borrowerAddress)
}

export async function verifyTokenState(address: string, expected: Record<string, number>): Promise<void> {
  const tokens = await getAppTokenState(address)
  for (const key in Object.keys(expected)) {
    expect(tokens[key]).toBe(expected[key])
  }
}

export async function verifyRepay(
  startState: Record<string, any>,
  endState: Record<string, any>,
  appId: number,
  invoice: LogicSigAccount,
): Promise<void> {
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const ownerTokenId = (await getLocalStateValue({
    address: invoice.address(),
    appId: minterId,
    key: 'asa_id',
  })) as number
  let invoiceValue = (await getLocalStateValue({
    address: invoice.address(),
    appId: minterId,
    key: 'value',
  })) as number
  invoiceValue = (invoiceValue * getConfigNumber('USDC_DECIMAL_SCALE')) / getConfigNumber('USD_CENTS_SCALE')
  const invoiceInfo = await algodClient.accountInformation(invoice.address()).do()
  let invoiceOwnTokenBalance = 0
  invoiceInfo.assets.forEach((asset) => {
    if (asset['asset-id'] === ownerTokenId) {
      invoiceOwnTokenBalance = asset.amount
    }
  })
  expect(invoiceOwnTokenBalance).toBe(2)
  expect(endState.borrower.usdc).toBe(startState.borrower.usdc - invoiceValue)
  expect(endState.investorEscrow.usdc).toBe(startState.investorEscrow.usdc + invoiceValue)
  expect(endState.app.algo).toBeGreaterThanOrEqual(startState.app.algo)
  expect(endState.investorEscrow.algo).toBeGreaterThanOrEqual(startState.investorEscrow.algo)
}
