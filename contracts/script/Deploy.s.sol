// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ColourcodeMiner} from "../src/ColourcodeMiner.sol";
import {ColourcodePool} from "../src/ColourcodePool.sol";

/// @notice Production deployment of ColourcodeMiner + ColourcodePool. Environment driven:
///
///   TOKEN             token address (the launched Pons token)                       required
///   TARGET_SPACING    seconds per block (T)                                          default 600
///   HALVING_INTERVAL  blocks per reward era                                          default 12960
///   INITIAL_TARGET    launch target, 0x-hex or decimal (see tools/initial-target.mjs) required
///   MIN_HOLD          WHOLE tokens a submitter must hold (scaled by decimals())      required
///   MIN_SPACING       minimum seconds between blocks                                 default 60
///   GENESIS_MESSAGE   genesis headline (fixed forever)                               required
///   POOL_OPERATOR     pool server wallet that posts payout roots (fixed forever)     required
///
/// The signer is chosen on the command line (--account / --ledger), never stored here.
/// On Robinhood Chain (4663) the script refuses to run unless CONFIRM_MAINNET=true.
/// Afterwards: transfer the reserve to the miner, then call start() from the SAME deployer (script/Start.s.sol).
contract Deploy is Script {
    function run() external returns (ColourcodeMiner miner, ColourcodePool pool) {
        if (block.chainid == 4663) {
            require(vm.envOr("CONFIRM_MAINNET", false), "Robinhood Chain mainnet: set CONFIRM_MAINNET=true");
        }

        address token = vm.envAddress("TOKEN");
        require(token.code.length > 0, "TOKEN has no code on this chain");
        uint256 targetSpacing = vm.envOr("TARGET_SPACING", uint256(600));
        uint256 halvingInterval = vm.envOr("HALVING_INTERVAL", uint256(12_960));
        uint256 initialTarget = vm.envUint("INITIAL_TARGET");
        uint256 minHoldWhole = vm.envUint("MIN_HOLD");
        uint256 minSpacing = vm.envOr("MIN_SPACING", uint256(60));
        string memory genesisMessage = vm.envString("GENESIS_MESSAGE");
        address operator = vm.envAddress("POOL_OPERATOR");

        uint8 decimals = IERC20Metadata(token).decimals();
        uint256 minHold = minHoldWhole * 10 ** decimals;

        vm.startBroadcast();
        miner = new ColourcodeMiner(
            IERC20(token), targetSpacing, halvingInterval, initialTarget, minHold, minSpacing, genesisMessage
        );
        pool = new ColourcodePool(IERC20(token), operator);
        vm.stopBroadcast();

        console2.log("chainId          ", block.chainid);
        console2.log("token            ", token);
        console2.log("ColourcodeMiner    ", address(miner));
        console2.log("ColourcodePool     ", address(pool));
        console2.log("deployer         ", miner.DEPLOYER());
        console2.log("pool operator    ", operator);
        console2.log("minHold (raw)    ", minHold);
        console2.log("initialTarget    ", vm.toString(bytes32(initialTarget)));
        console2.log("genesisChallenge ", vm.toString(miner.GENESIS_CHALLENGE()));
        console2.log(
            "Next: transfer the reserve to the miner, then run script/Start.s.sol with MINER=<miner>."
        );
    }
}
