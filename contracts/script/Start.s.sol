// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ColourcodeMiner} from "../src/ColourcodeMiner.sol";

/// @notice One-time start of the miner after the reserve is in. Must be signed by the deployer.
///   MINER   miner address                                                     required
/// On Robinhood Chain (4663) the script refuses to run unless CONFIRM_MAINNET=true.
contract Start is Script {
    function run() external {
        if (block.chainid == 4663) {
            require(vm.envOr("CONFIRM_MAINNET", false), "Robinhood Chain mainnet: set CONFIRM_MAINNET=true");
        }
        ColourcodeMiner miner = ColourcodeMiner(vm.envAddress("MINER"));
        uint256 reserve = miner.token().balanceOf(address(miner));
        console2.log("reserve in vault        ", reserve);
        console2.log("initialReward will be   ", reserve / (2 * miner.HALVING_INTERVAL()));

        vm.startBroadcast();
        miner.start();
        vm.stopBroadcast();

        (,,,,,,,, uint256 startTime, bool started) = miner.state();
        console2.log("started                 ", started);
        console2.log("startTime               ", startTime);
    }
}
