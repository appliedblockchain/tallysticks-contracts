# tallysticks/contracts: Algorand smart contracts and supporting components

This code has not been security audited and should only be used as an example.

## Setup

``` bash
npm i
```

## Tests

``` bash
./sandbox up dev
npm run test
./sandbox down
```

If you see `ERROR: No container found for algod_1`, it might be an issue with a previous sandbox container still hanging around somewhere. Try to find `sandbox_algod` with `docker container ls -a` and remove it with `docker container rm < container id >`.

## Deployment

Use this command to test your configuration before deploying the contract:

``` bash
npm run deploy:dry
```

Below are the environment variables that you can/need to set:

- Algod server configuration. Optional - by default the credentials for the sandbox will be used.
  - `ALGOD_SERVER` = the algod server host
  - `ALGOD_PORT` = the algod server port
  - `ALGOD_TOKEN` = the algod server token

- Application creator account. Either set `ADMIN_MNEMONIC` or `GENERATE_ADMIN_ACCOUNT=true`.
  - `ADMIN_MNEMONIC` = the mnemonic for the account that should create the application (needs to have algos)
  - `GENERATE_ADMIN_ACCOUNT` = If running in the sandbox, can set this to `true` to generate a temporary account for the admin - useful for testing.

- App and token ID configuration. Required.
  - `IDENTITY_ASSET_ID` = the asset ID of the silentdata-id identity token.
  - `SILENTDATA_MINT_APP_ID` = the application ID of the deployed silentdata-mint smart contract.
  - `CURRENCY_ASSET_ID` = the asset ID of the currency token (should be a stablecoin matching invoice currency).

Once you have a valid configuration, a file will be created in the [scripts/logs/](scripts/logs) directory with the suffix `_dry-run.json`.
Read this file to double check that you are happy with your configuration options.

Once happy, deploy for real using:

``` bash
npm run deploy
```

The details of the newly created application will be output in the logs directory, including its ID & program hash.

## Deployment to TestNet

### Create a new account on TestNet if you need to

Use this command to generate a new account:

``` bash
npm run generate-account
```

This will create a new randomly generated account & write the details to [scripts/logs/](scripts/logs) with the file prefix `account_`.

Go to the Algorand TestNet dispenser and get some Algos for testing by entering your newly generated address (see `addr` in the output file):
[https://bank.testnet.algorand.network/](https://bank.testnet.algorand.network/)

You can check that this worked by going to [https://testnet.algoexplorer.io/](https://testnet.algoexplorer.io/) and looking the account's address.

### Create a currency asset on TestNet if you need to

The matching contract requires an asset to use as its currency, normally this would be a stablecoin that tracks the value of the currency that invoices use.

Use this command to generate a dummy currency:

``` bash
npm run create-asset -- --name USDC --decimals 6
```

This will create a new asset & write the details to [scripts/logs/](scripts/logs) with the file prefix `asset_`.

You can also either set `CREATOR_MNEMONIC` or `GENERATE_CREATOR_ACCOUNT=true` to set the creator (and hence reserve address) of this asset.

Include the `--dry-run` flag to check the setup before actually creating the asset.

### Run the deployment script

- Set `ALGOD_SERVER`, `ALGOD_PORT` and `ALGOD_TOKEN` to point to the Applied Blockchain Algorand TestNet node (ask someone for the details if you don't know them already).
- Set `ADMIN_MNEMONIC` to the mnemonic of the account (if you generated it in the last step see `mn` in the output file)
- Set `GENERATE_ADMIN_ACCOUNT` to `false`
- Set `IDENTITY_ASSET_ID`, `SILENTDATA_MINT_APP_ID` and `CURRENCY_ASSET_ID` to the required values
- Run `npm run deploy:dry`
- Check the configuration, and once you're happy run: `npm run deploy`
- The newly created `appId` & `programHash` are printed to the log file

### Set up an organisation

- Call the POST `/organisations` endpoint with the admin auth key in the `x-admin-auth-key` header to create a new organisation.
  - This should return an address and mnemonic, which should be saved to 1Password.
- Transfer algos to the organisation account with the testnet faucet.
- Set the `USDC_ASSET_ID` and `MATCHING_APP_ID` env vars.
- Run the setup script

``` bash
npm run setup-organisation -- -m 'borrower mnemonic'
```
