import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { getTemporaryAccount, createAndOptInBorrower, createInvestorAndEscrow } from '../utils/account'
import { safeCreateCurrencyAsset } from '../utils/create-currency'
import { deployMatchingApp } from '../../operations/deploy-app'
import { createKYCToken } from '../utils/kyc'
import { getGlobalStateValue, getLocalStateValue } from '../../utils/state'
import {
  createDummyMintingApplication,
  dummyClaim,
  dummyMint,
  dummyMintAndClaim,
  defaultInvoiceParams,
} from '../utils/mint'
import {
  repay,
  verify,
  sendFunds,
  withdrawFunds,
  getBorrowerEscrow,
  initialiseBorrowerEscrow,
  getAndOptInBorrowerEscrow,
} from '../../operations/borrower-escrow'
import algosdk from 'algosdk'
import { isContractLogicEvalException, isContractException, isContractLogicException } from '../utils/error'
import { getCurrentTimestamp } from '../utils/timestamp'
import { bid, reclaim } from '../../operations/escrow'
import { action } from '../../operations/admin'
import { getMatchingAppState, verifyRepay, verifyBorrowerInvest } from '../utils/matching'
import { createTransferAssetTxn, signAndSendLsigTxn, transferAsset } from '../../utils/transactions'
import { algodClient } from '../../utils/init'
import { transferAlgos } from '../../utils/transfer-algos'
import { createOptInAssetTxn } from '../../utils/opt-in'
import { getAssetLogicSigAccount } from '@appliedblockchain/silentdata-mint'

describe('Borrower escrow actions', () => {
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

  describe('Get and opt in escrow', () => {
    let appId, borrower
    beforeAll(async () => {
      appId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      borrower = await createAndOptInBorrower(usdcId, appId, minterId)
    }, 20000)

    it('Getting escrow works', async () => {
      const escrow = await getBorrowerEscrow(borrower.addr, appId)
      expect(escrow.lsig.logic).not.toBe(null)
    }, 20000)

    it('Escrow can be initialised by sending algos and opting in to assets', async () => {
      const escrow = await getBorrowerEscrow(borrower.addr, appId)
      await initialiseBorrowerEscrow(escrow, appId, borrower)
      const accountInfo = await algodClient.accountInformation(escrow.address()).do()
      expect(accountInfo.assets.length).toBe(1)
      expect(accountInfo.assets[0]['asset-id']).toBe(usdcId)
      expect(accountInfo.assets[0].amount).toBe(0)
    }, 20000)

    it('Escrow cannot initialise escrow twice', async () => {
      expect.assertions(1)
      const escrow = await getBorrowerEscrow(borrower.addr, appId)
      try {
        await initialiseBorrowerEscrow(escrow, appId, borrower)
      } catch (e) {
        expect(isContractException(e)).toBe(true)
      }
    })

    it('Escrow will not opt in to an unrecognised asset', async () => {
      expect.assertions(1)
      const usdc2Id = await safeCreateCurrencyAsset(creator, 'USDC2', 6)
      const escrow = await getBorrowerEscrow(borrower.addr, appId)
      const params = await algodClient.getTransactionParams().do()
      await transferAlgos(borrower, escrow.address(), 201000)
      const txn = await createOptInAssetTxn(escrow.address(), usdc2Id, params)
      try {
        await signAndSendLsigTxn(escrow, txn)
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    }, 20000)
  })

  describe('Send and withdraw funds', () => {
    let appId, borrower, escrow, stateAddresses
    beforeAll(async () => {
      appId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      borrower = await createAndOptInBorrower(usdcId, appId, minterId)
      escrow = await getAndOptInBorrowerEscrow(borrower, appId)
      await transferAsset(creator, borrower.addr, usdcId, 10000)
      stateAddresses = { appId, borrowerAddress: borrower.addr, borrowerEscrowAddress: escrow.address() }
    }, 20000)

    it('Investor can send funds to escrow', async () => {
      const startState = await getMatchingAppState(stateAddresses)
      const investment = 100
      await sendFunds(borrower, appId, investment)
      const endState = await getMatchingAppState(stateAddresses)
      verifyBorrowerInvest(startState, endState, investment)
    }, 20000)

    it('Investor can withdraw funds from escrow', async () => {
      await sendFunds(borrower, appId, 100)
      const startState = await getMatchingAppState(stateAddresses)
      const withdrawal = 50
      await withdrawFunds(borrower.addr, appId, withdrawal)
      const endState = await getMatchingAppState(stateAddresses)
      expect(endState.borrower.usdc).toBe(startState.borrower.usdc + withdrawal)
      expect(endState.borrowerEscrow.usdc).toBe(startState.borrowerEscrow.usdc - withdrawal)
    }, 20000)

    it('Another user cannot withdraw funds from escrow', async () => {
      expect.assertions(1)
      const otherUser = await createAndOptInBorrower(usdcId, appId, minterId)
      const params = await algodClient.getTransactionParams().do()
      const txn = await createTransferAssetTxn({
        fromAddress: escrow.address(),
        toAddress: otherUser.addr,
        assetId: usdcId,
        amount: 50,
        params,
      })
      try {
        await signAndSendLsigTxn(escrow, txn)
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    }, 20000)
  })

  describe('Mint and claim invoices', () => {
    let appId, borrower, escrow, invoiceParams
    beforeAll(async () => {
      appId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      borrower = await createAndOptInBorrower(usdcId, appId, minterId)
      escrow = await getAndOptInBorrowerEscrow(borrower, appId)
      invoiceParams = defaultInvoiceParams
    }, 20000)

    it('An invoice can be minted', async () => {
      const invoiceId = await dummyMint({
        sender: escrow,
        appId: minterId,
        invoiceParams,
        programHash: progHash,
        enclaveKeys: keys,
      })
      const invoice = await getAssetLogicSigAccount(invoiceId, minterId)
      expect(await getLocalStateValue({ address: invoice.address(), appId: minterId, key: 'value' })).toBe(
        invoiceParams.value,
      )
      expect(await getLocalStateValue({ address: invoice.address(), appId: minterId, key: 'currency_code' })).toBe(
        invoiceParams.currency_code,
      )
      expect(await getLocalStateValue({ address: invoice.address(), appId: minterId, key: 'due_date' })).toBe(
        invoiceParams.due_date,
      )
      expect(await getLocalStateValue({ address: invoice.address(), appId: minterId, key: 'interest_rate' })).toBe(
        invoiceParams.interest_rate,
      )
      expect(await getLocalStateValue({ address: invoice.address(), appId: minterId, key: 'risk_score' })).toBe(
        invoiceParams.risk_score,
      )
    }, 50000)

    it('An invoice can be claimed', async () => {
      const invoiceId = await dummyMint({
        sender: escrow,
        appId: minterId,
        invoiceParams,
        programHash: progHash,
        enclaveKeys: keys,
      })
      const invoice = await dummyClaim(escrow, minterId, invoiceId)
      const tokenId = (await getLocalStateValue({
        address: invoice.address(),
        appId: minterId,
        key: 'asa_id',
      })) as number
      const escrowInfo = await algodClient.accountInformation(escrow.address()).do()
      expect(escrowInfo.assets.length).toBe(2)
      expect(escrowInfo.assets[1]['asset-id']).toBe(tokenId)
      expect(escrowInfo.assets[1].amount).toBe(1)
      const invoiceInfo = await algodClient.accountInformation(invoice.address()).do()
      expect(invoiceInfo.assets.length).toBe(1)
      expect(invoiceInfo.assets[0]['asset-id']).toBe(tokenId)
      expect(invoiceInfo.assets[0].amount).toBe(1)
    }, 50000)
  })

  describe('Verify an invoice', () => {
    let borrower, borrowerEscrow, invoice, invoiceParams, appId
    beforeAll(async () => {
      appId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      borrower = await createAndOptInBorrower(usdcId, appId, minterId)
      borrowerEscrow = await getAndOptInBorrowerEscrow(borrower, appId)

      invoiceParams = defaultInvoiceParams

      const invoiceId = await dummyMint({
        sender: borrowerEscrow,
        appId: minterId,
        invoiceParams,
        programHash: progHash,
        enclaveKeys: keys,
      })
      invoice = await dummyClaim(borrowerEscrow, minterId, invoiceId)
    }, 20000)

    it('Invoice cannot be verified if user not owner', async () => {
      expect.assertions(1)
      const borrower2 = await createAndOptInBorrower(usdcId, appId, minterId)
      await getAndOptInBorrowerEscrow(borrower2, appId)
      try {
        await verify(borrower2.addr, appId, invoice)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Valid invoice can be verified', async () => {
      await verify(borrower.addr, appId, invoice)
      expect(await getGlobalStateValue({ appId, key: 'bidding_timeout' })).toBeGreaterThan(getCurrentTimestamp())
      const invoiceAddress = (await getGlobalStateValue({
        appId,
        key: 'invoice_address',
        decodeValue: false,
      })) as Buffer
      const ownerAddress = (await getGlobalStateValue({ appId, key: 'owner_address', decodeValue: false })) as Buffer
      expect(algosdk.encodeAddress(invoiceAddress)).toBe(invoice.address())
      expect(algosdk.encodeAddress(ownerAddress)).toBe(borrowerEscrow.address())
    }, 20000)

    it('Invoice cannot be verified twice', async () => {
      expect.assertions(1)
      try {
        await verify(borrower.addr, appId, invoice)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)
  })

  describe('Repay an invoice', () => {
    let borrower, borrowerEscrow, invoice, appId, investorParams, investor, escrow
    beforeAll(async () => {
      appId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      borrower = await createAndOptInBorrower(usdcId, appId, minterId)
      borrowerEscrow = await getAndOptInBorrowerEscrow(borrower, appId)
      invoice = await dummyMintAndClaim({
        sender: borrowerEscrow,
        appId: minterId,
        invoiceParams: defaultInvoiceParams,
        programHash: progHash,
        enclaveKeys: keys,
      })
      const borrowerFunds =
        (getConfigNumber('MAXIMUM_LOAN_VALUE') * getConfigNumber('USDC_DECIMAL_SCALE')) /
        getConfigNumber('USD_CENTS_SCALE')
      await transferAsset(creator, borrowerEscrow.address(), usdcId, borrowerFunds)
      await transferAlgos(borrower, borrowerEscrow.address(), 1000000)

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
        await repay({ borrowerAddress: borrower.addr, appId, invoice, investorEscrow: escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice cannot be repaid before bidding', async () => {
      await verify(borrower.addr, appId, invoice)
      expect.assertions(1)
      try {
        await repay({ borrowerAddress: borrower.addr, appId, invoice, investorEscrow: escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice cannot be repaid before actioning', async () => {
      await bid(investor.addr, appId, invoice)
      expect.assertions(1)
      try {
        await repay({ borrowerAddress: borrower.addr, appId, invoice, investorEscrow: escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice cannot be repaid before tokens are reclaimed', async () => {
      await action(admin, investor.addr, appId)
      expect.assertions(1)
      try {
        await repay({ borrowerAddress: borrower.addr, appId, invoice, investorEscrow: escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice cannot be repaid by wrong borrower', async () => {
      await reclaim(investor.addr, appId)
      const wrongBorrower = await createAndOptInBorrower(usdcId, appId, minterId)
      await getAndOptInBorrowerEscrow(wrongBorrower, appId)
      expect.assertions(1)
      try {
        await repay({ borrowerAddress: wrongBorrower.addr, appId, invoice, investorEscrow: escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice cannot be repaid to wrong escrow', async () => {
      expect.assertions(1)
      const investorEscrow = await createInvestorAndEscrow(investorParams)
      try {
        await repay({ borrowerAddress: borrower.addr, appId, invoice, investorEscrow: investorEscrow.escrow })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Wrong invoice cannot be repaid', async () => {
      expect.assertions(1)
      const wrongInvoice = await dummyMintAndClaim({
        sender: borrowerEscrow,
        appId: minterId,
        programHash: progHash,
        enclaveKeys: keys,
      })
      try {
        await repay({ borrowerAddress: borrower.addr, appId, invoice: wrongInvoice, investorEscrow: escrow })
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
        await repay({
          borrowerAddress: borrower.addr,
          appId,
          invoice,
          investorEscrow: escrow,
          amount: invoiceValue - 1,
        })
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Invoice can be repaid after bidding process is over', async () => {
      const stateAddresses = {
        appId,
        investorAddress: investor.addr,
        investorEscrowAddress: escrow.address(),
        borrowerAddress: borrowerEscrow.address(),
      }
      const startState = await getMatchingAppState(stateAddresses)
      await repay({ borrowerAddress: borrower.addr, appId, invoice, investorEscrow: escrow })
      const endState = await getMatchingAppState(stateAddresses)
      await verifyRepay(startState, endState, appId, invoice)
    }, 20000)
  })
})
