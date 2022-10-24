import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { getTemporaryAccount, createAndOptInBorrower, createInvestorAndEscrow } from '../utils/account'
import { safeCreateCurrencyAsset } from '../utils/create-currency'
import { deployMatchingApp } from '../../operations/deploy-app'
import { createKYCToken } from '../utils/kyc'
import { getGlobalStateValue, getLocalStateValue } from '../../utils/state'
import {
  dummyMintAndClaim,
  defaultInvoiceParams,
  createDummyMintingApplication,
  dummyMint,
  dummyClaim,
} from '../utils/mint'
import { repay, verify } from '../../operations/borrower'
import algosdk from 'algosdk'
import { isContractLogicEvalException } from '../utils/error'
import { getCurrentTimestamp } from '../utils/timestamp'
import { bid, reclaim } from '../../operations/escrow'
import { action } from '../../operations/admin'
import { getMatchingAppState, verifyRepay } from '../utils/matching'
import { transferAsset } from '../../utils/transactions'

describe('Borrower actions', () => {
  let creator, admin, usdcId, idTokenId, minterId, progHash, keys
  beforeAll(async () => {
    creator = await getTemporaryAccount()
    admin = await getTemporaryAccount()

    usdcId = await safeCreateCurrencyAsset(creator, 'USDC', 6)
    idTokenId = await createKYCToken(creator)

    const { appId, programHash, enclaveKeys } = await createDummyMintingApplication(creator)
    minterId = appId
    progHash = programHash
    keys = enclaveKeys
  }, 20000)

  describe('Verify an invoice', () => {
    let borrower, invoice, invoiceParams, appId
    beforeAll(async () => {
      appId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      borrower = await createAndOptInBorrower(usdcId, appId, minterId)

      invoiceParams = defaultInvoiceParams

      const invoiceId = await dummyMint({
        sender: borrower,
        appId: minterId,
        invoiceParams,
        programHash: progHash,
        enclaveKeys: keys,
      })
      invoice = await dummyClaim(borrower, minterId, invoiceId)
    }, 20000)

    it('Invoice cannot be verified if user not owner', async () => {
      expect.assertions(1)
      const borrower2 = await createAndOptInBorrower(usdcId, appId, minterId)
      try {
        await verify(borrower2, appId, invoice)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Worthless invoice cannot be verified', async () => {
      expect.assertions(1)
      const badInvoiceId = await dummyMint({
        sender: borrower,
        appId: minterId,
        invoiceParams: { ...invoiceParams, value: 0 },
        programHash: progHash,
        enclaveKeys: keys,
      })
      const badInvoice = await dummyClaim(borrower, minterId, badInvoiceId)
      try {
        await verify(borrower, appId, badInvoice)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice in wrong currency cannot be verified', async () => {
      expect.assertions(1)
      const badInvoiceId = await dummyMint({
        sender: borrower,
        appId: minterId,
        invoiceParams: { ...invoiceParams, currency_code: 'GBP' },
        programHash: progHash,
        enclaveKeys: keys,
      })
      const badInvoice = await dummyClaim(borrower, minterId, badInvoiceId)
      try {
        await verify(borrower, appId, badInvoice)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice due in the past cannot be verified', async () => {
      expect.assertions(1)
      const badInvoiceId = await dummyMint({
        sender: borrower,
        appId: minterId,
        invoiceParams: {
          ...invoiceParams,
          due_date: getCurrentTimestamp() - 500,
        },
        programHash: progHash,
        enclaveKeys: keys,
      })
      const badInvoice = await dummyClaim(borrower, minterId, badInvoiceId)
      try {
        await verify(borrower, appId, badInvoice)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invalid risk score invoice cannot be verified', async () => {
      expect.assertions(1)
      const badInvoiceId = await dummyMint({
        sender: borrower,
        appId: minterId,
        invoiceParams: { ...invoiceParams, risk_score: 180 },
        programHash: progHash,
        enclaveKeys: keys,
      })
      const badInvoice = await dummyClaim(borrower, minterId, badInvoiceId)
      try {
        await verify(borrower, appId, badInvoice)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Valid invoice can be verified', async () => {
      try {
        await verify(borrower, appId, invoice)
      } catch (e) {
        console.log(e)
      }
      expect(await getGlobalStateValue({ appId, key: 'bidding_timeout' })).toBeGreaterThan(getCurrentTimestamp())
      const invoiceAddress = (await getGlobalStateValue({
        appId,
        key: 'invoice_address',
        decodeValue: false,
      })) as Buffer
      const ownerAddress = (await getGlobalStateValue({ appId, key: 'owner_address', decodeValue: false })) as Buffer
      expect(algosdk.encodeAddress(invoiceAddress)).toBe(invoice.address())
      expect(algosdk.encodeAddress(ownerAddress)).toBe(borrower.addr)
    }, 20000)

    it('Invoice cannot be verified twice', async () => {
      expect.assertions(1)
      try {
        await verify(borrower, appId, invoice)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)
  })

  describe('Repay an invoice', () => {
    let borrower, invoice, appId, investorParams, investor, escrow
    beforeAll(async () => {
      appId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      borrower = await createAndOptInBorrower(usdcId, appId, minterId)
      invoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        programHash: progHash,
        enclaveKeys: keys,
      })
      const borrowerFunds =
        (getConfigNumber('MAXIMUM_LOAN_VALUE') * getConfigNumber('USDC_DECIMAL_SCALE')) /
        getConfigNumber('USD_CENTS_SCALE')
      await transferAsset(creator, borrower.addr, usdcId, borrowerFunds)

      investorParams = {
        admin,
        creator,
        usdcId,
        appId,
        idTokenId,
      }
      const investorEscrow = await createInvestorAndEscrow(investorParams)
      investor = investorEscrow.investor
      escrow = investorEscrow.escrow
    }, 20000)

    it('Invoice cannot be repaid if unverified', async () => {
      expect.assertions(1)
      try {
        await repay({ borrower, appId, invoice, escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice cannot be repaid before bidding', async () => {
      await verify(borrower, appId, invoice)
      expect.assertions(1)
      try {
        await repay({ borrower, appId, invoice, escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice cannot be repaid before actioning', async () => {
      await bid(investor.addr, appId, invoice)
      expect.assertions(1)
      try {
        await repay({ borrower, appId, invoice, escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice cannot be repaid before tokens are reclaimed', async () => {
      await action(admin, investor.addr, appId)
      expect.assertions(1)
      try {
        await repay({ borrower, appId, invoice, escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice cannot be repaid by wrong borrower', async () => {
      await reclaim(investor.addr, appId)
      const wrongBorrower = await createAndOptInBorrower(usdcId, appId, minterId)
      expect.assertions(1)
      try {
        await repay({ borrower: wrongBorrower, appId, invoice, escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice cannot be repaid to wrong escrow', async () => {
      expect.assertions(1)
      const investorEscrow = await createInvestorAndEscrow(investorParams)
      try {
        await repay({ borrower, appId, invoice, escrow: investorEscrow.escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Wrong invoice cannot be repaid', async () => {
      expect.assertions(1)
      const wrongInvoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        programHash: progHash,
        enclaveKeys: keys,
      })
      try {
        await repay({ borrower, appId, invoice: wrongInvoice, escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Wrong amount cannot be repaid', async () => {
      expect.assertions(1)
      const invoiceValue = (await getLocalStateValue({
        address: invoice.address(),
        appId: minterId,
        key: 'value',
      })) as number
      try {
        await repay({ borrower, appId, invoice, escrow, amount: invoiceValue - 1 })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice can be repaid after bidding process is over', async () => {
      const stateAddresses = {
        appId,
        investorAddress: investor.addr,
        investorEscrowAddress: escrow.address(),
        borrowerAddress: borrower.addr,
      }
      const startState = await getMatchingAppState(stateAddresses)
      await repay({ borrower, appId, invoice, escrow })
      const endState = await getMatchingAppState(stateAddresses)
      await verifyRepay(startState, endState, appId, invoice)
    }, 20000)
  })
})
