// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ColourcodeMiner} from "../src/ColourcodeMiner.sol";

/// @notice LOCAL ONLY dev helper: finds a nonce for the current challenge (in the script VM) and submits mint()
///         with the anvil operator key (account #1). Reads the miner address from deploy.local.json.
///
///   forge script script/MineLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///   BENEFICIARY=0x... (default: the pool)
///
/// If it says "too early", wait minSpacing seconds (or `cast rpc evm_increaseTime 600` on anvil).
contract MineLocal is Script {
    uint256 internal constant ANVIL_KEY_1 =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    function run() external {
        require(
            block.chainid == 31337 || vm.envOr("LOCAL_FORK", false),
            "MineLocal.s.sol is for a local anvil only"
        );

        string memory json = vm.readFile("./deploy.local.json");
        ColourcodeMiner miner = ColourcodeMiner(vm.parseJsonAddress(json, ".miner"));
        address beneficiary = vm.envOr("BENEFICIARY", vm.parseJsonAddress(json, ".pool"));

        (
            bytes32 challenge,
            uint256 target,
            uint256 height,,
            uint256 lastBlockTime,,,
            uint256 minSpacing,,
            bool started
        ) = miner.state();
        require(started, "miner not started");
        if (block.timestamp < lastBlockTime + minSpacing) {
            console2.log("too early, wait seconds:", lastBlockTime + minSpacing - block.timestamp);
            return;
        }

        uint256 first = uint256(keccak256(abi.encode(block.timestamp, height)));
        uint256 nonce = _search(challenge, beneficiary, target, first);
        console2.log("hashes tried:", nonce - first + 1);

        vm.startBroadcast(ANVIL_KEY_1);
        uint256 reward = miner.mint(nonce, beneficiary);
        vm.stopBroadcast();

        console2.log("mined height:", height + 1);
        console2.log("reward      :", reward);
        console2.log("nonce       :", nonce);
    }

    /// @dev keccak256(challenge ++ beneficiary ++ nonce) over a fixed 84-byte buffer (no memory growth).
    function _search(bytes32 challenge, address beneficiary, uint256 target, uint256 nonce)
        internal
        pure
        returns (uint256)
    {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, challenge)
            mstore(add(ptr, 32), shl(96, beneficiary))
            for {} 1 {} {
                mstore(add(ptr, 52), nonce)
                if iszero(gt(keccak256(ptr, 84), target)) { break }
                nonce := add(nonce, 1)
            }
        }
        return nonce;
    }
}
