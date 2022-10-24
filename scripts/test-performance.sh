docker run --rm \
           -v $PWD:/workspace \
           -v $PWD/../contract-config:/contract-config \
           -v $PWD/../silentdata-mint:/silentdata-mint \
           tallysticks/algorand-node bash -c "cd workspace && npm run test -- tests/performance --runInBand"