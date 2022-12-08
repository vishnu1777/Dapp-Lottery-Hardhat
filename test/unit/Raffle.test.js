
const { assert, expect } = require("chai")
const { network, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
        let raffle, raffleContract, vrfCoordinatorV2Mock, raffleEntranceFee, interval, player // , deployer

        beforeEach(async () => {
            accounts = await ethers.getSigners() // could also do with getNamedAccounts
            //   deployer = accounts[0]
            player = accounts[1]
            await deployments.fixture(["mocks", "raffle"]) // Deploys modules with the tags "mocks" and "raffle"
            vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock") // Returns a new connection to the VRFCoordinatorV2Mock contract
            raffleContract = await ethers.getContract("Raffle") // Returns a new connection to the Raffle contract
            raffle = raffleContract.connect(player) // Returns a new instance of the Raffle contract connected to player
            raffleEntranceFee = await raffle.getEntranceFee()
            interval = await raffle.getInterval()
        })
        console.log(`This is entrance Fee From raffle:${raffleEntranceFee}`)

        describe("constructor", function () {
            it("initializes the raffle correctly", async () => {
                // Ideally, we'd separate these out so that only 1 assert per "it" block
                // And ideally, we'd make this check everything
                const raffleState = (await raffle.getRaffleState()).toString()
                // Comparisons for Raffle initialization:
                assert.equal(raffleState, "0")
                assert.equal(
                    interval.toString(),
                    networkConfig[network.config.chainId]["keepersUpdateInterval"]
                )
            })
        })

        describe("enterRaffle", function () {
            it("reverts when you don't pay enough", async () => {
                await expect(raffle.enterRaffle()).to.be.revertedWith( // is reverted when not paid enough or raffle is not open
                    "Raffle__SendMoreToEnterRaffle"
                )
            })
            it("records player when they enter", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                const contractPlayer = await raffle.getPlayer(0)
                assert.equal(player.address, contractPlayer)
            })
            it("emits event on enter", async () => {
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit( // emits RaffleEnter event if entered to index player(s) address
                    raffle,
                    "RaffleEnter"
                )
            })

            it("doesn't allow entering of players when calculation", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                /* refer to this if You didn't get the below code :https://hardhat.org/hardhat-network/docs/reference*/
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                await raffle.performUpkeep([])
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith("Raffle__RaffleNotOpen")
            })
        })
        // describe does not recognize async function if you use it or not
        describe("checkUpKeep", () => {
            it("Returns false if people doesn't send any eth", async () => {
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                /* we can also use this: await network.provider.request({ method: "evm_mine", params: [] })*/
                await network.provider.send("evm_mine", [])
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                assert(!upkeepNeeded)
            })
            it("returns false if Raffle isn't open ", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                await raffle.performUpkeep("0x")
                const raffleState = await raffle.getRaffleState()
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                assert.equal(raffleState.toString(), "1")
                assert.equal(upkeepNeeded, false)

            })
            it("returns false if enough time hasn't passed", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(!upkeepNeeded)
            })
            it("returns true if enough time has passed, has players, eth, and is open", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(upkeepNeeded)
            })
        })

        describe("perform Upkeep", () => {
            it("It only runs when checkUpKeep is true", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const tx = await raffle.performUpkeep("0x")
                assert(tx)

            })

            it("Reverts when chekUpKeep is false", async () => {
                await expect(raffle.performUpkeep("0x")).to.be.revertedWith("Raffle__UpkeepNotNeeded")
            })
            it("updates the raffle state,emits the event,calls the v2Coordinator", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const txResponse = await raffle.performUpkeep("0x") // emits requestId
                const txReceipt = await txResponse.wait(1) // waits 1 block
                const raffleState = await raffle.getRaffleState() // updates state
                const requestId = txReceipt.events[1].args.requestId
                assert(requestId.toNumber() > 0)
                assert(raffleState == 1) // 0 = open, 1 = calculating

            })
        })
        describe("fullfill Random Words", () => {
            beforeEach(async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
            })

            it("can only be called after performUpKeep", async () => {
                await expect(
                    vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address) // reverts if not fulfilled
                ).to.be.revertedWith("nonexistent request")
                await expect(
                    vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address) // reverts if not fulfilled
                ).to.be.revertedWith("nonexistent request")
            })
            // This test is too big...
            // This test simulates users entering the raffle and wraps the entire functionality of the raffle
            // inside a promise that will resolve if everything is successful.
            // An event listener for the WinnerPicked is set up
            // Mocks of chainlink keepers and vrf coordinator are used to kickoff this winnerPicked event
            // All the assertions are done once the WinnerPicked event is fired
            it("picks a winner, resets, and sends money", async () => {
                const additionalEntrances = 3 // to test
                const startingIndex = 2
                for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) { // i = 2; i < 5; i=i+1
                    raffle = raffleContract.connect(accounts[i]) // Returns a new instance of the Raffle contract connected to player
                    await raffle.enterRaffle({ value: raffleEntranceFee })
                }
                const startingTimeStamp = await raffle.getLastTimeStamp() // stores starting timestamp (before we fire our event)

                // This will be more important for our staging tests...
                await new Promise(async (resolve, reject) => {
                    raffle.once("WinnerPicked", async () => { // event listener for WinnerPicked
                        console.log("WinnerPicked event fired!")
                        // assert throws an error if it fails, so we need to wrap
                        // it in a try/catch so that the promise returns event
                        // if it fails.
                        try {
                            // Now lets get the ending values...
                            const recentWinner = await raffle.getRecentWinner()
                            const raffleState = await raffle.getRaffleState()
                            const winnerBalance = await accounts[2].getBalance()
                            const endingTimeStamp = await raffle.getLastTimeStamp()
                            await expect(raffle.getPlayer(0)).to.be.reverted
                            // Comparisons to check if our ending values are correct:
                            assert.equal(recentWinner.toString(), accounts[2].address)
                            assert.equal(raffleState, 0)
                            assert.equal(
                                winnerBalance.toString(),
                                startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                    .add(
                                        raffleEntranceFee
                                            .mul(additionalEntrances)
                                            .add(raffleEntranceFee)
                                    )
                                    .toString()
                            )
                            assert(endingTimeStamp > startingTimeStamp)
                            resolve() // if try passes, resolves the promise 
                        } catch (e) {
                            reject(e) // if try fails, rejects the promise
                        }
                    })

                    // kicking off the event by mocking the chainlink keepers and vrf coordinator
                    const tx = await raffle.performUpkeep("0x")
                    const txReceipt = await tx.wait(1)
                    const startingBalance = await accounts[2].getBalance()
                    await vrfCoordinatorV2Mock.fulfillRandomWords(
                        txReceipt.events[1].args.requestId,
                        raffle.address
                    )
                })
            })
        })
    })