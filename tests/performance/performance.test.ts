import seedrandom from 'seedrandom'
import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { bid, reclaim, getEscrow } from '../../operations/escrow'
import { getTemporaryAccount, createInvestorAndEscrow, createAndOptInBorrower } from '../utils/account'
import { safeCreateCurrencyAsset } from '../utils/create-currency'
import { deployMatchingApp } from '../../operations/deploy-app'
import { action, unfreeze, reset } from '../../operations/admin'
import { freeze, invest, withdraw } from '../../operations/investor'
import { createKYCToken } from '../utils/kyc'
import { getGlobalStateValue, getLocalStateValue, hasGlobalStateValue } from '../../utils/state'
import { createDummyMintingApplication, dummyMintAndClaim, defaultInvoiceParams, InvoiceParams } from '../utils/mint'
import { verify, repay, getBorrowerEscrow } from '../../operations/borrower-escrow'
import { getCurrentTimestamp, incrementLatestTimestamp } from '../utils/timestamp'
import { getAppTokenIds, getAppTokenState } from '../../utils/matching-helpers'
import algosdk, { Account, LogicSigAccount } from 'algosdk'
import { algodClient } from '../../utils/init'
import {
  calculateCost,
  getContractErrorMessage,
  getMatchingAppState,
  verifyAction,
  verifyBid,
  verifyFreeze,
  verifyInvest,
  verifyReclaim,
  verifyRepay,
  verifyUnfreeze,
  verifyWithdraw,
  verifyReset,
  verifyVerify,
} from '../utils'
import { getAndOptInBorrowerEscrow } from '../../operations/borrower-escrow'
import { transferAlgos } from '../../utils/transfer-algos'
import { transferAsset } from '../../utils/transactions'

const usdcScale = getConfigNumber('USDC_DECIMAL_SCALE')
const valueScale = getConfigNumber('USD_CENTS_SCALE')
const valueToUsdc = usdcScale / valueScale
const secondToDay = 1 / (24 * 60 * 60)
const valueToUsd = 1 / 100
const usdcToUsd = 1 / 1000000

const PRINT_INFO = true
const PRINT_COSTS = false
const NUM_DAYS = 40
const NUM_INVESTORS = 10
const MIN_UNFREEZE_USDC = getConfigNumber('MINIMUM_LOAN_VALUE') * valueToUsdc
const MIN_BORROW = getConfigNumber('MINIMUM_LOAN_VALUE')
const MAX_BORROW = getConfigNumber('MAXIMUM_LOAN_VALUE')
// Speed up time by treating seconds as days
// Then increase the interest by the same factor to get realistic prices
const MIN_TERM = getConfigNumber('MINIMUM_LOAN_TERM') * secondToDay
const MAX_TERM = getConfigNumber('MAXIMUM_LOAN_TERM') * secondToDay
const MIN_INTEREST = getConfigNumber('MINIMUM_LOAN_INTEREST') / secondToDay
const MAX_INTEREST = (10 * getConfigNumber('INTEREST_SCALE')) / secondToDay
const INVEST_PROBABILITY = 0.1
const WITHDRAW_PROBABILITY = 0.1
const FREEZE_PROBABILITY = 0.1
const UNFREEZE_PROBABILITY = 0.5
const BORROW_PROBABILITY = 0.5
const BID_TIME_LIMIT = 2 // seconds = "days"

const unfreezeWithVerify = async (appId: number, admin: Account, investor: Account) => {
  const escrow = await getEscrow(investor.addr, appId)
  const addresses = {
    appId: appId,
    adminAddress: admin.addr,
    investorAddress: investor.addr,
    investorEscrowAddress: escrow.address(),
  }
  if (PRINT_INFO) {
    console.log(`${investor.addr} unfreezing account`)
  }
  const startState = await getMatchingAppState(addresses)
  await unfreeze(admin, investor.addr, appId)
  const endState = await getMatchingAppState(addresses)
  if (PRINT_COSTS) {
    console.log('Unfreeze cost:', calculateCost(startState, endState))
  }
  verifyUnfreeze(startState, endState)
}

const withdrawWithVerify = async (appId: number, admin: Account, investor: Account, withdrawal: number) => {
  const escrow = await getEscrow(investor.addr, appId)
  const addresses = {
    appId: appId,
    adminAddress: admin.addr,
    investorAddress: investor.addr,
    investorEscrowAddress: escrow.address(),
  }
  if (PRINT_INFO) {
    console.log(`${investor.addr} withdrawing ${withdrawal * usdcToUsd} USD`)
  }
  const startState = await getMatchingAppState(addresses)
  await withdraw(investor, appId, withdrawal)
  const endState = await getMatchingAppState(addresses)
  if (PRINT_COSTS) {
    console.log('Withdraw cost:', calculateCost(startState, endState))
  }
  verifyWithdraw(startState, endState, withdrawal)
}

const investWithVerify = async (appId: number, admin: Account, investor: Account, investment: number) => {
  const escrow = await getEscrow(investor.addr, appId)
  const addresses = {
    appId: appId,
    adminAddress: admin.addr,
    investorAddress: investor.addr,
    investorEscrowAddress: escrow.address(),
  }
  if (PRINT_INFO) {
    console.log(`${investor.addr} investing ${investment * usdcToUsd} USD`)
  }
  const startState = await getMatchingAppState(addresses)
  await invest(investor, appId, investment)
  const endState = await getMatchingAppState(addresses)
  if (PRINT_COSTS) {
    console.log('Invest cost:', calculateCost(startState, endState))
  }
  verifyInvest(startState, endState, investment)
}

const freezeWithVerify = async (appId: number, admin: Account, investor: Account) => {
  const escrow = await getEscrow(investor.addr, appId)
  const addresses = {
    appId: appId,
    adminAddress: admin.addr,
    investorAddress: investor.addr,
    investorEscrowAddress: escrow.address(),
  }
  if (PRINT_INFO) {
    console.log(`${investor.addr} freezing account`)
  }
  const startState = await getMatchingAppState(addresses)
  await freeze(investor, appId)
  const endState = await getMatchingAppState(addresses)
  if (PRINT_COSTS) {
    console.log('Freeze cost:', calculateCost(startState, endState))
  }
  verifyFreeze(startState, endState)
}

const bidWithVerify = async (appId: number, admin: Account, investor: Account, invoice: LogicSigAccount) => {
  const escrow = await getEscrow(investor.addr, appId)
  const escrowTokens = await getAppTokenState(escrow.address())
  if (escrowTokens.access === 1) {
    const addresses = {
      appId: appId,
      adminAddress: admin.addr,
      investorAddress: investor.addr,
      investorEscrowAddress: escrow.address(),
    }
    if (PRINT_INFO) {
      console.log(`${escrow.address()} bidding with balance ${escrowTokens.usdc * usdcToUsd} USD`)
    }
    const startState = await getMatchingAppState(addresses)
    await bid(investor.addr, appId, invoice)
    const endState = await getMatchingAppState(addresses)
    if (PRINT_COSTS) {
      console.log('Bid cost:', calculateCost(startState, endState))
    }
    verifyBid(startState, endState)
  }
}

const reclaimWithVerify = async (appId: number, admin: Account, investor: Account) => {
  const escrow = await getEscrow(investor.addr, appId)
  const escrowTokens = await getAppTokenState(escrow.address())
  if (escrowTokens.access === 1) {
    if (PRINT_INFO) {
      console.log(`${escrow.address()} reclaiming token`)
    }
    const addresses = {
      appId: appId,
      adminAddress: admin.addr,
      investorAddress: investor.addr,
      investorEscrowAddress: escrow.address(),
    }
    const startState = await getMatchingAppState(addresses)
    await reclaim(investor.addr, appId)
    const endState = await getMatchingAppState(addresses)
    if (PRINT_COSTS) {
      console.log('Reclaim cost:', calculateCost(startState, endState))
    }
    verifyReclaim(startState, endState, escrow)
  }
}

const verifyWithVerify = async (
  appId: number,
  borrower: Account,
  invoiceParams: InvoiceParams,
  programHash: Uint8Array,
  enclaveKeys: nacl.SignKeyPair,
) => {
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const borrowerEscrow = await getBorrowerEscrow(borrower.addr, appId)
  if (PRINT_INFO) {
    console.log(
      `Verifying invoice with value ${invoiceParams.value * valueToUsd} USD, due date ${
        invoiceParams.due_date
      } and interest ${invoiceParams.interest_rate}`,
    )
  }
  const invoice = await dummyMintAndClaim({
    sender: borrowerEscrow,
    appId: minterId,
    invoiceParams,
    programHash,
    enclaveKeys,
  })

  const addresses = {
    appId: appId,
    borrowerAddress: borrower.addr,
    borrowerEscrowAddress: borrowerEscrow.address(),
  }
  const startState = await getMatchingAppState(addresses)
  await verify(borrower.addr, appId, invoice)
  const endState = await getMatchingAppState(addresses)
  if (PRINT_INFO) {
    console.log(`Invoice ${invoice.address()} verified`)
  }
  if (PRINT_COSTS) {
    console.log('Verify cost:', calculateCost(startState, endState))
  }
  verifyVerify(startState, endState)
  return invoice
}

const actionWithVerify = async (
  appId: number,
  admin: Account,
  borrowerAddress: string,
  invoice: LogicSigAccount,
  investors: any,
) => {
  const escrowAddressBuffer = (await getGlobalStateValue({
    appId,
    key: 'escrow_address',
    decodeValue: false,
  })) as Buffer
  const escrowAddress = algosdk.encodeAddress(escrowAddressBuffer)

  if (PRINT_INFO) {
    console.log(`${escrowAddress} buying invoice`)
  }
  const winner = investors.find((element) => element.escrow.address() === escrowAddress)

  const addresses = {
    appId,
    adminAddr: admin.addr,
    investorAddress: winner.investor.addr,
    investorEscrowAddress: escrowAddress,
    borrowerAddress,
  }
  const startState = await getMatchingAppState(addresses)
  await action(admin, winner.investor.addr, appId)
  const endState = await getMatchingAppState(addresses)
  if (PRINT_COSTS) {
    console.log('Action cost:', calculateCost(startState, endState))
  }
  await verifyAction({
    startState,
    endState,
    appId,
    invoice,
    escrow: winner.escrow,
    borrowerAddress,
  })
}

const resetWithVerify = async (appId: number, admin: Account, borrower: Account) => {
  const borrowerEscrow = await getBorrowerEscrow(borrower.addr, appId)
  if (PRINT_INFO) {
    console.log('Resetting the contract as no winner found')
  }
  const addresses = {
    appId,
    adminAddress: admin.addr,
    borrowerAddress: borrower.addr,
    borrowerEscrowAddress: borrowerEscrow.address(),
  }
  const startState = await getMatchingAppState(addresses)
  await reset(admin, appId)
  const endState = await getMatchingAppState(addresses)
  if (PRINT_COSTS) {
    console.log('Reset cost:', calculateCost(startState, endState))
  }
  verifyReset(startState, endState)
}

const getOwnershipToken = async (appId: number, invoice: LogicSigAccount) => {
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const minterAddress = algosdk.getApplicationAddress(minterId)
  const accountInfo = await algodClient.accountInformation(invoice.address()).do()
  for (const asset of accountInfo.assets) {
    const assetInfo = await algodClient.getAssetByID(asset['asset-id']).do()
    if (assetInfo.params.creator === minterAddress) {
      return asset
    }
  }
  return null
}

const repayWithVerify = async (
  appId: number,
  borrower: Account,
  invoice: LogicSigAccount,
  value: number,
  investors: any,
) => {
  const ownershipToken = await getOwnershipToken(appId, invoice)

  const borrowerEscrow = await getBorrowerEscrow(borrower.addr, appId)
  let repaymentEscrow, repaymentInvestor
  for (const { investor, escrow } of investors) {
    const escrowInfo = await algodClient.accountInformation(escrow.address()).do()
    for (const asset of escrowInfo.assets) {
      if (asset['asset-id'] === ownershipToken['asset-id']) {
        repaymentEscrow = escrow
        repaymentInvestor = investor
      }
    }
  }
  if (PRINT_INFO) {
    console.log(`${borrowerEscrow.address()} repaying ${repaymentEscrow.address()} ${value * valueToUsd} USD`)
  }
  const addresses = {
    appId,
    investorAddress: repaymentInvestor.addr,
    investorEscrowAddress: repaymentEscrow.address(),
    borrowerAddress: borrowerEscrow.address(),
  }
  const startState = await getMatchingAppState(addresses)
  await repay({
    borrowerAddress: borrower.addr,
    appId,
    invoice,
    investorEscrow: repaymentEscrow,
    amount: value * valueToUsdc,
  })
  const endState = await getMatchingAppState(addresses)
  if (PRINT_COSTS) {
    console.log('Repay cost:', calculateCost(startState, endState))
  }
  await verifyRepay(startState, endState, appId, invoice)
}

const isRepaid = async (appId: number, invoice: LogicSigAccount) => {
  const ownershipToken = await getOwnershipToken(appId, invoice)
  if (ownershipToken.amount === 2) {
    return true
  }
  if (ownershipToken.amount !== 1) {
    throw new Error('Invalid ownership token balance')
  }
  return false
}

const isDue = async (appId: number, invoice: LogicSigAccount) => {
  const minterId = (await getGlobalStateValue({ appId, key: 'minter_id' })) as number
  const dueDate = await getLocalStateValue({ address: invoice.address(), appId: minterId, key: 'due_date' })
  return getCurrentTimestamp() >= dueDate
}

describe('Matching app performance', () => {
  let creator, usdcId, idTokenId, minterId, admin, appId, borrower, borrowerEscrow, rng, progHash, keys
  const investors = []
  beforeAll(async () => {
    const seed = Math.random().toString()
    console.log(`Random number generator seed = ${seed}`)
    rng = seedrandom(seed)
    creator = await getTemporaryAccount()
    admin = await getTemporaryAccount()

    usdcId = await safeCreateCurrencyAsset(creator, 'USDC', 6)
    idTokenId = await createKYCToken(creator)

    const { appId: mintId, programHash, enclaveKeys } = await createDummyMintingApplication(creator)
    minterId = mintId
    progHash = programHash
    keys = enclaveKeys

    appId = await deployMatchingApp({
      sender: admin,
      identityTokenId: idTokenId,
      minterId,
      currencyId: usdcId,
      bidTimeLimit: BID_TIME_LIMIT,
    })

    // Override default escrow parameters
    process.env['MINIMUM_LOAN_TERM'] = `${MIN_TERM}`
    process.env['MAXIMUM_LOAN_TERM'] = `${MAX_TERM}`
    process.env['MINIMUM_LOAN_INTEREST'] = `${MIN_INTEREST}`
    const investorParams = {
      admin,
      creator,
      usdcId,
      appId,
      idTokenId,
      initialAlgos: 10000000,
    }
    for (let i = 0; i < NUM_INVESTORS; i++) {
      investors.push(await createInvestorAndEscrow(investorParams))
    }

    borrower = await createAndOptInBorrower(usdcId, appId, minterId)
    borrowerEscrow = await getAndOptInBorrowerEscrow(borrower, appId)
    await transferAlgos(borrower, borrowerEscrow.address(), 40000000)

    const tokens = await getAppTokenIds(appId)
    let setupSummary = `
      Setup summary:
      Applications:
      - Fake minter (${minterId}) = ${algosdk.getApplicationAddress(minterId)}
      - Matching app (${appId}) = ${algosdk.getApplicationAddress(appId)}
      Tokens:
      - USDC = ${usdcId}
      - Identity = ${idTokenId}
      - Bidding = ${tokens.bid}
      - Access = ${tokens.access}
      Accounts:
      - Admin = ${admin.addr}
      - Creator = ${creator.addr}
      - Borrower = ${borrower.addr}
      -- Escrow = ${borrowerEscrow.address()}
      - Investors:\n`
    for (const { investor, escrow } of investors) {
      setupSummary = setupSummary.concat(
        `      -- Investor = ${investor.addr}\n      --- Escrow = ${escrow.address()}\n`,
      )
    }
    if (PRINT_INFO) {
      console.log(setupSummary)
    }
  }, 20000)

  afterAll(() => {
    // Reset overrides of default escrow parameters
    process.env['MINIMUM_LOAN_TERM'] = getConfigNumber('MINIMUM_LOAN_TERM').toString()
    process.env['MAXIMUM_LOAN_TERM'] = getConfigNumber('MAXIMUM_LOAN_TERM').toString()
    process.env['MINIMUM_LOAN_INTEREST'] = getConfigNumber('MINIMUM_LOAN_INTEREST').toString()
  })

  it('Operates under normal usage', async () => {
    // Possible actions
    // - Investor withdraws funds
    // - Investor deposits funds
    // - Investor freezes account
    // - Investor unfreezes account
    // - Borrower verifies invoice
    // - Borrower repays loan

    const invoices = []
    // Loop over "days"
    for (let i = 0; i < NUM_DAYS; i++) {
      try {
        // Loop over investors
        for (const { investor, escrow } of investors) {
          const investorTokens = await getAppTokenState(investor.addr)
          const escrowTokens = await getAppTokenState(escrow.address())

          // Random chance investor will unfreeze account if frozen
          if (escrowTokens.access === 0 && escrowTokens.usdc >= MIN_UNFREEZE_USDC && rng() > 1 - UNFREEZE_PROBABILITY) {
            console.log(escrowTokens.usdc * usdcToUsd, MIN_UNFREEZE_USDC * usdcToUsd)
            await unfreezeWithVerify(appId, admin, investor)
          }

          // Random chance investor will withdraw
          if (escrowTokens.usdc > 0 && rng() > 1 - WITHDRAW_PROBABILITY) {
            const withdrawal = Math.floor(rng() * escrowTokens.usdc)
            await withdrawWithVerify(appId, admin, investor, withdrawal)
          }

          // Random chance investor will deposit
          if (investorTokens.usdc > 0 && rng() > 1 - INVEST_PROBABILITY) {
            const investment = Math.floor(rng() * investorTokens.usdc)
            await investWithVerify(appId, admin, investor, investment)
          }

          // Random chance investor will freeze account if unfrozen
          if (escrowTokens.access === 1 && rng() > 1 - FREEZE_PROBABILITY) {
            await freezeWithVerify(appId, admin, investor)
          }
        }

        // Random chance borrower will verify an invoice
        if (rng() > 1 - BORROW_PROBABILITY) {
          const invoiceParams = defaultInvoiceParams
          const value = Math.floor(MIN_BORROW + rng() * (MAX_BORROW - MIN_BORROW))
          const due_date = getCurrentTimestamp() + Math.floor(MIN_TERM + rng() * (MAX_TERM - MIN_TERM))
          const interest_rate = Math.floor(MIN_INTEREST + rng() * (MAX_INTEREST - MIN_INTEREST))
          const invoice = await verifyWithVerify(
            appId,
            borrower,
            { ...invoiceParams, value, due_date, interest_rate },
            progHash,
            keys,
          )

          for (const { investor } of investors) {
            await bidWithVerify(appId, admin, investor, invoice)
          }

          if (await hasGlobalStateValue(appId, 'escrow_address')) {
            await actionWithVerify(appId, admin, borrowerEscrow.address(), invoice, investors)
            invoices.push(invoice)
          } else {
            // If there's no winner must wait and have admin reset
            await incrementLatestTimestamp(BID_TIME_LIMIT + 1)
            await resetWithVerify(appId, admin, borrower)
          }
          for (const { investor } of investors) {
            await reclaimWithVerify(appId, admin, investor)
          }
        }

        console.log('Checking for repayments')
        // Borrower repays any due loans
        for (const invoice of invoices) {
          if (isRepaid(appId, invoice)) {
            continue
          }

          if (isDue(appId, invoice)) {
            const value = (await getLocalStateValue({
              address: invoice.address(),
              appId: minterId,
              key: 'value',
            })) as number
            await transferAsset(creator, borrowerEscrow.address(), usdcId, value)
            await repayWithVerify(appId, borrower, invoice, value, investors)
          }
        }
        await incrementLatestTimestamp(1)
      } catch (e) {
        const errMsg = getContractErrorMessage(e)
        if (errMsg) {
          console.log(errMsg)
        } else {
          console.log(e)
        }
        expect(true).toBe(false)
      }
    }
  }, 400000)
})
