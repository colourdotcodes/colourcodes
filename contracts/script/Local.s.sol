// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ColourcodeMiner} from "../src/ColourcodeMiner.sol";
import {ColourcodePool} from "../src/ColourcodePool.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @notice LOCAL ONLY. Deploys MockERC20 + ColourcodeMiner + ColourcodePool on a local anvil, funds and starts the
///         miner, and writes the addresses to contracts/deploy.local.json.
///
///   anvil --port 8545 --block-time 1
///   forge script script/Local.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///
/// Uses the public anvil test keys only:  account #0 = deployer, account #1 = pool operator.
/// Accounts #0..#7 receive 1,000,000 mock tokens (holders); #8 and #9 receive none (non-holders).
/// On a fresh anvil the addresses are always the same as in deploy.local.json.
/// Refuses any chain other than 31337 unless LOCAL_FORK=true (a local anvil fork of 4663 on 127.0.0.1).
///
/// Local defaults differ from production so blocks come quickly in a browser: T = 60 s, minSpacing = 10 s,
/// target sized for ~200 kH/s. Override with the same env names as Deploy.s.sol.
contract Local is Script {
    // Public anvil / hardhat default keys (mnemonic "test test ... junk"). Worthless outside a local node.
    uint256 internal constant ANVIL_KEY_0 =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant ANVIL_KEY_1 =
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    struct Params {
        uint256 targetSpacing;
        uint256 halvingInterval;
        uint256 initialTarget;
        uint256 minHold;
        uint256 minSpacing;
        uint256 reserve;
        string genesisMessage;
    }

    struct Deployed {
        MockERC20 token;
        ColourcodeMiner miner;
        ColourcodePool pool;
        uint256 startBlock;
    }

    function run() external {
        require(
            block.chainid == 31337 || vm.envOr("LOCAL_FORK", false), "Local.s.sol is for a local anvil only"
        );
        Params memory p = _params();
        Deployed memory d = _deploy(p);
        string memory json = _json(p, d);
        vm.writeJson(json, "./deploy.local.json");
        console2.log(json);
    }

    function _params() internal view returns (Params memory p) {
        p.targetSpacing = vm.envOr("TARGET_SPACING", uint256(60));
        p.halvingInterval = vm.envOr("HALVING_INTERVAL", uint256(12_960));
        // 2^256 / (200,000 H/s * 60 s): one browser finds a block about every minute
        p.initialTarget = vm.envOr("INITIAL_TARGET", type(uint256).max / 12_000_000);
        p.minHold = vm.envOr("MIN_HOLD", uint256(1_000)) * 1e18;
        p.minSpacing = vm.envOr("MIN_SPACING", uint256(10));
        p.reserve = vm.envOr("RESERVE", uint256(10_500_000)) * 1e18;
        p.genesisMessage = vm.envOr("GENESIS_MESSAGE", string("colour.codes local genesis"));
    }

    function _deploy(Params memory p) internal returns (Deployed memory d) {
        // where to start scanning events; 0 on a plain anvil so a redeploy on another fresh node is covered too
        d.startBlock = block.chainid == 31337 ? 0 : block.number;
        address operator = vm.addr(ANVIL_KEY_1);
        vm.startBroadcast(ANVIL_KEY_0);
        d.token = new MockERC20("Mock colour.codes", "mCCODE");
        d.miner = new ColourcodeMiner(
            IERC20(address(d.token)),
            p.targetSpacing,
            p.halvingInterval,
            p.initialTarget,
            p.minHold,
            p.minSpacing,
            p.genesisMessage
        );
        d.pool = new ColourcodePool(IERC20(address(d.token)), operator);
        for (uint256 i = 0; i < 8; ++i) {
            d.token.mint(vm.addr(_anvilKey(i)), 1_000_000e18);
        }
        d.token.mint(address(d.miner), p.reserve);
        d.miner.start();
        vm.stopBroadcast();
    }

    function _json(Params memory p, Deployed memory d) internal returns (string memory) {
        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "startBlock", d.startBlock);
        vm.serializeAddress(o, "token", address(d.token));
        vm.serializeAddress(o, "miner", address(d.miner));
        vm.serializeAddress(o, "pool", address(d.pool));
        vm.serializeAddress(o, "deployer", vm.addr(ANVIL_KEY_0));
        vm.serializeAddress(o, "operator", vm.addr(ANVIL_KEY_1));
        vm.serializeString(o, "operatorNote", "anvil default account #1 (public test key, local only)");
        vm.serializeString(
            o, "holdersNote", "anvil accounts #0..#7 hold 1,000,000 mock tokens; #8 and #9 hold none"
        );
        vm.serializeUint(o, "targetSpacing", p.targetSpacing);
        vm.serializeUint(o, "halvingInterval", p.halvingInterval);
        vm.serializeString(o, "initialTarget", vm.toString(p.initialTarget));
        vm.serializeString(o, "initialTargetHex", vm.toString(bytes32(p.initialTarget)));
        vm.serializeString(o, "minHold", vm.toString(p.minHold));
        vm.serializeUint(o, "minSpacing", p.minSpacing);
        vm.serializeString(o, "reserve", vm.toString(p.reserve));
        vm.serializeString(o, "genesisChallenge", vm.toString(d.miner.GENESIS_CHALLENGE()));
        return vm.serializeString(o, "genesisMessage", p.genesisMessage);
    }

    function _anvilKey(uint256 i) internal pure returns (uint256) {
        // derive the default anvil keys from the public test mnemonic
        string memory mnemonic = "test test test test test test test test test test test junk";
        return vm.deriveKey(mnemonic, uint32(i));
    }
}
