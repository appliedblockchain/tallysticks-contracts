import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { bid, getAndOptInEscrow } from '../../operations/escrow'
import {
  getTemporaryAccount,
  createAndOptInInvestor,
  createInvestorAndEscrow,
  createAndOptInBorrower,
} from '../utils/account'
import { safeCreateCurrencyAsset } from '../utils/create-currency'
import { deployMatchingApp } from '../../operations/deploy-app'
import { action, reset, setBidTimeLimit, unfreeze } from '../../operations/admin'
import { transferAlgos } from '../../utils/transfer-algos'
import { freeze, invest, withdraw } from '../../operations/investor'
import { isContractLogicEvalException, isContractException } from '../utils/error'
import { createKYCToken, whitelistInvestor } from '../utils/kyc'
import { getGlobalStateValue, getLocalStateValue, hasGlobalStateValue } from '../../utils/state'
import { getMatchingAppState, verifyAction, verifyTokenState } from '../utils/matching'
import { createDummyMintingApplication, dummyMintAndClaim } from '../utils/mint'
import { verify } from '../../operations/borrower'
import { getCurrentTimestamp, incrementLatestTimestamp } from '../utils/timestamp'
import algosdk from 'algosdk'

describe('Admin actions', () => {
  let creator, usdcId, idTokenId, minterId, progHash, keys
  beforeAll(async () => {
    creator = await getTemporaryAccount()

    usdcId = await safeCreateCurrencyAsset(creator, 'USDC', 6)
    idTokenId = await createKYCToken(creator)

    const { appId, programHash, enclaveKeys } = await createDummyMintingApplication(creator)
    minterId = appId
    progHash = programHash
    keys = enclaveKeys
  }, 20000)

  describe('Unfreeze an account', () => {
    let admin, appId, investor, escrow, minimumBalance
    beforeAll(async () => {
      admin = await getTemporaryAccount()
      appId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      investor = await createAndOptInInvestor(creator, usdcId)
      await whitelistInvestor(investor, creator, idTokenId)

      escrow = await getAndOptInEscrow(investor, appId)
      minimumBalance = getConfigNumber('MAX_BIDDING_FEES') + getConfigNumber('UNFREEZE_FEE')
      await transferAlgos(investor, escrow.address(), minimumBalance)
      const initialInvestment =
        (getConfigNumber('MAXIMUM_LOAN_VALUE') * getConfigNumber('USDC_DECIMAL_SCALE')) /
        getConfigNumber('USD_CENTS_SCALE')
      await invest(investor, appId, initialInvestment)
    }, 20000)

    it('non-admin cannot unfreeze an account', async () => {
      expect.assertions(1)
      try {
        await unfreeze(investor, investor.addr, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Admin can unfreeze an account', async () => {
      await unfreeze(admin, investor.addr, appId)
      await verifyTokenState(escrow.address(), { bid: 1, access: 1 })
      const investorAddress = (await getLocalStateValue({
        address: escrow.address(),
        appId,
        key: 'investor_address',
        decodeValue: false,
      })) as Buffer
      expect(algosdk.encodeAddress(investorAddress)).toBe(investor.addr)
    }, 20000)

    it('Account cannot be unfrozen twice', async () => {
      expect.assertions(1)
      try {
        await unfreeze(admin, investor.addr, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Account can be unfrozen if its frozen again', async () => {
      await transferAlgos(investor, escrow.address(), minimumBalance)
      await freeze(investor, appId)
      await unfreeze(admin, investor.addr, appId)
      await verifyTokenState(escrow.address(), { bid: 1, access: 1 })
      const timestamp = await getLocalStateValue({ address: escrow.address(), appId, key: 'timestamp' })
      expect(timestamp).toBeLessThanOrEqual(getCurrentTimestamp())
    }, 20000)

    it('Account with insufficient currency cannot be unfrozen', async () => {
      expect.assertions(1)
      await withdraw(investor, appId, getConfigNumber('MINIMUM_TRANSACTION_FEE'))
      try {
        await unfreeze(admin, investor.addr, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Account associated with non-whitelisted investor cannot be unfrozen', async () => {
      expect.assertions(1)
      const investor2 = await createAndOptInInvestor(creator, usdcId)
      const escrow2 = await getAndOptInEscrow(investor2, appId)
      await transferAlgos(investor2, escrow2.address(), minimumBalance)
      await invest(investor2, appId, 50)
      try {
        await unfreeze(admin, investor2.addr, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Account with insufficient algos cannot be unfrozen', async () => {
      expect.assertions(1)
      const investor2 = await createAndOptInInvestor(creator, usdcId)
      await whitelistInvestor(investor2, creator, idTokenId)
      const escrow2 = await getAndOptInEscrow(investor2, appId)
      await transferAlgos(investor2, escrow2.address(), minimumBalance - getConfigNumber('MINIMUM_TRANSACTION_FEE'))
      await invest(investor2, appId, 50)
      try {
        await unfreeze(admin, investor2.addr, appId)
      } catch (e) {
        expect(isContractException(e)).toBe(true)
      }
    }, 20000)
  })

  describe('Action a winning bid', () => {
    let admin, investor1, escrow1, investor2, appId, borrower, invoice
    beforeAll(async () => {
      admin = await getTemporaryAccount()
      appId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      const investorParams = { admin, creator, usdcId, appId, idTokenId }
      const investorEscrow1 = await createInvestorAndEscrow(investorParams)
      investor1 = investorEscrow1.investor
      escrow1 = investorEscrow1.escrow

      const investorEscrow2 = await createInvestorAndEscrow(investorParams)
      investor2 = investorEscrow2.investor

      borrower = await createAndOptInBorrower(usdcId, appId, minterId)
      invoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        programHash: progHash,
        enclaveKeys: keys,
      })
      await verify(borrower, appId, invoice)
      await bid(investor1.addr, appId, invoice)
    }, 20000)

    it('Cannot action a winning bid if not all bids made', async () => {
      expect.assertions(1)
      try {
        await action(admin, investor1.addr, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Non admin cannot action a winning bid', async () => {
      expect.assertions(1)
      await bid(investor2.addr, appId, invoice)
      try {
        await action(investor1, investor1.addr, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Cannot action a winning bid from wrong escrow', async () => {
      expect.assertions(1)
      try {
        await action(admin, investor2.addr, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Cannot action a winning bid with incorrect price', async () => {
      expect.assertions(1)
      try {
        await action(admin, investor1.addr, appId, 200)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Admin can action a winning bid', async () => {
      const stateAddresses = {
        appId,
        investorAddress: investor1.addr,
        investorEscrowAddress: escrow1.address(),
        borrowerAddress: borrower.addr,
      }
      const startState = await getMatchingAppState(stateAddresses)
      const startTimestamp = (await getLocalStateValue({
        address: escrow1.address(),
        appId,
        key: 'timestamp',
      })) as number
      await action(admin, investor1.addr, appId)
      const endState = await getMatchingAppState(stateAddresses)
      const endTimestamp = (await getLocalStateValue({ address: escrow1.address(), appId, key: 'timestamp' })) as number
      await verifyAction({ startState, endState, appId, invoice, escrow: escrow1, borrowerAddress: borrower.addr })
      expect(endTimestamp).toBeGreaterThan(startTimestamp)
    }, 20000)
  })

  describe('Reset the matching app', () => {
    let admin, appId, borrower
    beforeAll(async () => {
      admin = await getTemporaryAccount()
      appId = await deployMatchingApp({
        sender: admin,
        identityTokenId: idTokenId,
        minterId,
        currencyId: usdcId,
        bidTimeLimit: 2,
      })

      borrower = await createAndOptInBorrower(usdcId, appId, minterId)

      const invoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        programHash: progHash,
        enclaveKeys: keys,
      })
      await verify(borrower, appId, invoice)
    }, 20000)

    it('Cannot reset before bidding timeout is up', async () => {
      expect.assertions(1)
      try {
        await reset(admin, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Non admin cannot reset', async () => {
      expect.assertions(1)
      await incrementLatestTimestamp(4)
      try {
        await reset(borrower, appId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Can be reset by admin if bidding timeout is up', async () => {
      await reset(admin, appId)
      expect(await hasGlobalStateValue(appId, 'owner_address')).toBe(false)
      expect(await hasGlobalStateValue(appId, 'escrow_address')).toBe(false)
      expect(await hasGlobalStateValue(appId, 'invoice_address')).toBe(false)
      expect(await hasGlobalStateValue(appId, 'leading_timestamp')).toBe(false)
    }, 20000)

    it('Cannot be reset if not in bidding period', async () => {
      expect.assertions(1)
      try {
        await reset(admin, appId)
      } catch (e) {
        expect(e).toBeTruthy()
      }
    }, 20000)
  })

  describe('Set global state', () => {
    let admin, appId
    beforeAll(async () => {
      admin = await getTemporaryAccount()
      appId = await deployMatchingApp({
        sender: admin,
        identityTokenId: idTokenId,
        minterId,
        currencyId: usdcId,
        bidTimeLimit: 2,
      })
    }, 20000)

    it('Can set the bid time limit', async () => {
      await setBidTimeLimit(admin, appId, 3)
      expect(await getGlobalStateValue({ appId, key: 'bid_time_limit' })).toBe(3)
    }, 20000)

    it('Non admin cannot set bid time limit', async () => {
      expect.assertions(1)
      const notAdmin = await getTemporaryAccount()
      try {
        await setBidTimeLimit(notAdmin, appId, 4)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)
  })
})
