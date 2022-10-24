import { getConfigNumber } from '@appliedblockchain/tallysticks-contract-config'
import { bid, getAndOptInEscrow, getEscrow, initialiseEscrow, reclaim } from '../../operations/escrow'
import {
  getTemporaryAccount,
  createAndOptInInvestor,
  createAndOptInBorrower,
  createInvestorAndEscrow,
} from '../utils/account'
import { algodClient } from '../../utils/init'
import { safeCreateCurrencyAsset } from '../utils/create-currency'
import { deployMatchingApp } from '../../operations/deploy-app'
import { signAndSendLsigTxn } from '../../utils/transactions'
import { isContractException, isContractLogicEvalException, isContractLogicException } from '../utils/error'
import { transferAlgos } from '../../utils/transfer-algos'
import { createDummyMintingApplication, dummyMintAndClaim, defaultInvoiceParams } from '../utils/mint'
import { createKYCToken } from '../utils/kyc'
import { getGlobalStateValue, getLocalStateValue, hasGlobalStateValue } from '../../utils/state'
import algosdk from 'algosdk'
import { freeze, withdraw } from '../../operations/investor'
import { verify } from '../../operations/borrower'
import { getCurrentTimestamp } from '../utils/timestamp'
import { getMatchingAppState } from '../utils/matching'
import { action } from '../../operations/admin'
import { createOptInAssetTxn } from '../../utils/opt-in'

describe('Escrow operations', () => {
  let creator, usdcId, idTokenId, appId, minterId, progHash, keys
  beforeAll(async () => {
    creator = await getTemporaryAccount()

    usdcId = await safeCreateCurrencyAsset(creator, 'USDC', 6)
    idTokenId = await createKYCToken(creator)
    const { appId: mintId, programHash, enclaveKeys } = await createDummyMintingApplication(creator)
    minterId = mintId
    progHash = programHash
    keys = enclaveKeys
    appId = await deployMatchingApp({ sender: creator, identityTokenId: idTokenId, minterId, currencyId: usdcId })
  }, 20000)

  describe('Get and initialise escrow account', () => {
    let investor
    beforeAll(async () => {
      investor = await createAndOptInInvestor(creator, usdcId)
    }, 20000)

    it('Getting escrow works', async () => {
      const escrow = await getEscrow(investor.addr, appId)
      expect(escrow.lsig.logic).not.toBe(null)
    }, 20000)

    it('Escrow cannot opt in to a single asset', async () => {
      expect.assertions(1)
      const escrow = await getEscrow(investor.addr, appId)
      const params = await algodClient.getTransactionParams().do()
      await transferAlgos(investor, escrow.address(), 201000)
      const txn = await createOptInAssetTxn(escrow.address(), usdcId, params)
      try {
        await signAndSendLsigTxn(escrow, txn)
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    })

    it('Escrow can be initialised by sending algos and opting in to assets', async () => {
      const escrow = await getEscrow(investor.addr, appId)
      await initialiseEscrow(escrow, appId, investor)
      const accountInfo = await algodClient.accountInformation(escrow.address()).do()
      expect(accountInfo.assets.length).toBe(1)
      expect(accountInfo.assets[0]['asset-id']).toBe(usdcId)
      expect(accountInfo.assets[0].amount).toBe(0)
    }, 20000)

    it('Escrow cannot initialise escrow twice', async () => {
      expect.assertions(1)
      const escrow = await getEscrow(investor.addr, appId)
      try {
        await initialiseEscrow(escrow, appId, investor)
      } catch (e) {
        expect(isContractException(e)).toBe(true)
      }
    })

    it('Escrow will not opt in to an unrecognised asset', async () => {
      expect.assertions(1)
      const usdc2Id = await safeCreateCurrencyAsset(creator, 'USDC2', 6)
      const escrow = await getEscrow(investor.addr, appId)
      const params = await algodClient.getTransactionParams().do()
      await transferAlgos(investor, escrow.address(), 201000)
      const txn = await createOptInAssetTxn(escrow.address(), usdc2Id, params)
      try {
        await signAndSendLsigTxn(escrow, txn)
      } catch (e) {
        expect(isContractLogicException(e)).toBe(true)
      }
    }, 20000)
  })

  describe('Bid with an escrow account', () => {
    let admin, matchId, investor, escrow, borrower, invoiceParams
    const initialUsdc =
      (getConfigNumber('MINIMUM_LOAN_VALUE') * getConfigNumber('USDC_DECIMAL_SCALE')) /
      getConfigNumber('USD_CENTS_SCALE')
    beforeEach(async () => {
      admin = await getTemporaryAccount()
      matchId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      const investorEscrow = await createInvestorAndEscrow({
        admin,
        creator,
        usdcId,
        appId: matchId,
        idTokenId,
        initialInvestment: initialUsdc,
      })
      investor = investorEscrow.investor
      escrow = investorEscrow.escrow

      borrower = await createAndOptInBorrower(usdcId, matchId, minterId)

      invoiceParams = defaultInvoiceParams
    }, 20000)

    const tests = [
      { value: getConfigNumber('MAXIMUM_LOAN_VALUE') + 1 },
      { value: getConfigNumber('MINIMUM_LOAN_VALUE') - 1 },
      { due_date: getCurrentTimestamp() + getConfigNumber('MINIMUM_LOAN_TERM') - 100 },
      { due_date: getCurrentTimestamp() + getConfigNumber('MAXIMUM_LOAN_TERM') + 100 },
      { interest_rate: getConfigNumber('MINIMUM_LOAN_INTEREST') - 1 },
      { risk_score: getConfigNumber('MAXIMUM_LOAN_RISK') + 1 },
    ]

    tests.forEach((test) => {
      it(`Escrow will not accept an invoice with non acceptable ${Object.keys(test)[0]}`, async () => {
        expect.assertions(1)
        const badInvoice = await dummyMintAndClaim({
          sender: borrower,
          appId: minterId,
          invoiceParams: { ...invoiceParams, ...test },
          programHash: progHash,
          enclaveKeys: keys,
        })
        await verify(borrower, matchId, badInvoice)
        await bid(investor.addr, matchId, badInvoice)
        try {
          await getGlobalStateValue({ appId: matchId, key: 'leading_timestamp' })
        } catch (e) {
          expect(e).toBeTruthy()
        }
      }, 20000)
    })

    it(`Escrow will not successfully bid on invoice if it doesn't have enough funds`, async () => {
      expect.assertions(1)
      const badInvoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        invoiceParams: { ...invoiceParams, value: initialUsdc + 10 },
        programHash: progHash,
        enclaveKeys: keys,
      })
      await verify(borrower, matchId, badInvoice)
      await bid(investor.addr, matchId, badInvoice)
      try {
        await getGlobalStateValue({ appId: matchId, key: 'leading_timestamp' })
      } catch (e) {
        expect(e).toBeTruthy()
      }
    }, 20000)

    it('Frozen escrow cannot bid', async () => {
      expect.assertions(1)
      const invoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        invoiceParams,
        programHash: progHash,
        enclaveKeys: keys,
      })
      await freeze(investor, matchId)
      await verify(borrower, matchId, invoice)
      try {
        await bid(investor.addr, matchId, invoice)
      } catch (e) {
        expect(isContractException(e)).toBe(true)
      }
    }, 20000)

    it('Escrow can bid on an invoice', async () => {
      const invoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        invoiceParams,
        programHash: progHash,
        enclaveKeys: keys,
      })
      await verify(borrower, matchId, invoice)
      await bid(investor.addr, matchId, invoice)
      const escrowAddress = (await getGlobalStateValue({
        appId: matchId,
        key: 'escrow_address',
        decodeValue: false,
      })) as Buffer
      expect(algosdk.encodeAddress(escrowAddress)).toBe(escrow.address())
      const timestamp = await getLocalStateValue({ address: escrow.address(), appId: matchId, key: 'timestamp' })
      expect(await getGlobalStateValue({ appId: matchId, key: 'leading_timestamp' })).toBe(timestamp)
    }, 20000)

    it('Escrow cannot bid twice on an invoice', async () => {
      expect.assertions(1)
      const invoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        invoiceParams,
        programHash: progHash,
        enclaveKeys: keys,
      })
      await verify(borrower, matchId, invoice)
      await bid(investor.addr, matchId, invoice)
      try {
        await bid(investor.addr, matchId, invoice)
      } catch (e) {
        expect(isContractException(e)).toBe(true)
      }
    }, 20000)

    it('Escrow with lowest timestamp will win bid', async () => {
      const investorParams = {
        admin,
        creator,
        usdcId,
        appId: matchId,
        idTokenId,
      }
      const investorEscrow1 = await createInvestorAndEscrow(investorParams)
      const investorEscrow2 = await createInvestorAndEscrow(investorParams)
      const invoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        invoiceParams,
        programHash: progHash,
        enclaveKeys: keys,
      })
      await verify(borrower, matchId, invoice)
      await bid(investorEscrow1.investor.addr, matchId, invoice)
      await bid(investorEscrow2.investor.addr, matchId, invoice)
      const escrowAddress = (await getGlobalStateValue({
        appId: matchId,
        key: 'escrow_address',
        decodeValue: false,
      })) as Buffer
      expect(algosdk.encodeAddress(escrowAddress)).toBe(investorEscrow1.escrow.address())
      const timestamp = await getLocalStateValue({
        address: investorEscrow1.escrow.address(),
        appId: matchId,
        key: 'timestamp',
      })
      expect(await getGlobalStateValue({ appId: matchId, key: 'leading_timestamp' })).toBe(timestamp)
    }, 20000)

    it('Investor cannot withdraw after bid has been made', async () => {
      const invoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        invoiceParams,
        programHash: progHash,
        enclaveKeys: keys,
      })
      await verify(borrower, matchId, invoice)
      await bid(investor.addr, matchId, invoice)
      try {
        await withdraw(investor, matchId, 10)
      } catch (e) {
        console.log(e)
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)
  })

  describe('Reclaim bidding token', () => {
    let admin, matchId, borrower, invoice
    const investors = []
    const escrows = []
    beforeAll(async () => {
      admin = await getTemporaryAccount()
      matchId = await deployMatchingApp({ sender: admin, identityTokenId: idTokenId, minterId, currencyId: usdcId })
      for (let i = 0; i < 3; i++) {
        let initialAlgos = getConfigNumber('INVESTOR_ESCROW_INITIAL_BALANCE')
        if (i === 1) {
          // TODO get this from the configuration once all fees are worked out
          initialAlgos =
            getConfigNumber('MAX_BIDDING_FEES') +
            getConfigNumber('UNFREEZE_FEE') -
            getConfigNumber('MINIMUM_TRANSACTION_FEE')
        }
        const investorEscrow = await createInvestorAndEscrow({
          admin,
          creator,
          usdcId,
          appId: matchId,
          idTokenId,
          initialAlgos,
        })
        investors.push(investorEscrow.investor)
        escrows.push(investorEscrow.escrow)
      }

      borrower = await createAndOptInBorrower(usdcId, matchId, minterId)

      invoice = await dummyMintAndClaim({
        sender: borrower,
        appId: minterId,
        programHash: progHash,
        enclaveKeys: keys,
      })
      await verify(borrower, matchId, invoice)
      await bid(investors[0].addr, matchId, invoice)
    }, 20000)

    it('Escrow cannot reclaim bidding token before bidding is over', async () => {
      expect.assertions(1)
      try {
        await reclaim(investors[0].addr, matchId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Escrow cannot reclaim bidding token before loan is actioned', async () => {
      expect.assertions(1)
      await bid(investors[1].addr, matchId, invoice)
      await bid(investors[2].addr, matchId, invoice)
      try {
        await reclaim(investors[0].addr, matchId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Escrow can reclaim bidding token after loan is actioned', async () => {
      await action(admin, investors[0].addr, matchId)
      await reclaim(investors[0].addr, matchId)
      const endState = await getMatchingAppState({
        appId: matchId,
        investorAddress: investors[0].addr,
        investorEscrowAddress: escrows[0].address(),
      })
      expect(endState.investorEscrow.bid).toBe(1)
      expect(endState.investorEscrow.access).toBe(1)
      expect(await hasGlobalStateValue(matchId, 'bidding_timeout')).toBe(true)
    }, 20000)

    it('Wrong escrow cannot reclaim bidding token', async () => {
      expect.assertions(1)
      const wrongInvestor = await createAndOptInInvestor(creator, usdcId)
      await getAndOptInEscrow(wrongInvestor, matchId)
      try {
        await reclaim(wrongInvestor.addr, matchId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Escrow cannot reclaim bidding token twice', async () => {
      expect.assertions(1)
      try {
        await reclaim(investors[0].addr, matchId)
      } catch (e) {
        expect(isContractLogicEvalException(e)).toBe(true)
      }
    }, 20000)

    it('Access token is revoked if escrow does not have enough funds', async () => {
      await reclaim(investors[1].addr, matchId)
      const endState = await getMatchingAppState({
        appId: matchId,
        investorAddress: investors[1].addr,
        investorEscrowAddress: escrows[1].address(),
      })
      expect(endState.investorEscrow.bid).toBe(0)
      expect(endState.investorEscrow.access).toBe(0)
      expect(await hasGlobalStateValue(matchId, 'bidding_timeout')).toBe(true)
    }, 20000)

    it('Matching app is unlocked after last escrow reclaims token', async () => {
      await reclaim(investors[2].addr, matchId)
      const endState = await getMatchingAppState({
        appId: matchId,
        investorAddress: investors[2].addr,
        investorEscrowAddress: escrows[2].address(),
      })
      expect(endState.investorEscrow.bid).toBe(1)
      expect(endState.investorEscrow.access).toBe(1)
      expect(await hasGlobalStateValue(matchId, 'bidding_timeout')).toBe(false)
    }, 20000)
  })
})
