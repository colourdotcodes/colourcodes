// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ColourcodeMiner} from "../src/ColourcodeMiner.sol";
import {ColourcodePool} from "../src/ColourcodePool.sol";
import {Base} from "./Base.t.sol";

/// @notice Full flow on a fork of Robinhood Chain (chain id 4663) through a LOCAL anvil fork.
///         Skipped unless FORK_URL is set. Run (see README):
///           anvil --fork-url https://robinhood.drpc.org --chain-id 4663 --port 8547 --block-time 1
///           FORK_URL=http://127.0.0.1:8547 forge test --match-contract ForkTest -vv
///         Uses a MockERC20 because the real token is not launched yet. Nothing is broadcast.
contract ForkTest is Base {
    bool internal forked;
    ColourcodeMiner internal miner;
    ColourcodePool internal pool;

    function setUp() public {
        string memory url = vm.envOr("FORK_URL", string(""));
        if (bytes(url).length == 0) return;
        vm.createSelectFork(url);
        forked = true;

        token = _newToken();
        // realistic production parameters except an easy target so the test finds nonces quickly
        miner = _deployMiner(T, HALVING, EASY_TARGET, MIN_SPACING);
        pool = new ColourcodePool(IERC20(address(token)), operator);
    }

    function test_fork_robinhoodChainFullFlow() public {
        vm.skip(!forked);
        assertEq(block.chainid, 4663, "not a Robinhood Chain fork");
        assertGt(block.number, 1_000_000, "fork has no history");

        // genesis challenge is bound to chain 4663
        assertEq(miner.GENESIS_CHALLENGE(), keccak256(abi.encode(uint256(4663), keccak256(bytes(GENESIS)))));

        _fundAndStart(miner, RESERVE);
        uint256 r0 = RESERVE / (2 * HALVING);

        // the pool operator finds three blocks for the pool, a solo holder finds one for herself
        uint256 found;
        for (uint256 i = 0; i < 3; ++i) {
            found += _mineBlock(miner, operator, address(pool));
        }
        uint256 solo = _mineBlock(miner, alice, alice);
        assertEq(found, 3 * r0);
        assertEq(solo, r0);
        assertEq(_height(miner), 4);
        assertEq(token.balanceOf(address(miner)), RESERVE - 4 * r0);

        // a non-holder can not submit
        vm.warp(block.timestamp + T);
        (uint256 nonce,) = _findNonce(miner, carol, 0);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ColourcodeMiner.NotHolder.selector, MIN_HOLD - 1, MIN_HOLD));
        miner.mint(nonce, carol);

        // the pool pays out by merkle root
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = _leaf(alice, found / 2);
        leaves[1] = _leaf(bob, found / 2);
        vm.prank(operator);
        pool.postEpoch(1, _root(leaves), found);
        pool.claim(1, alice, found / 2, _proof(leaves, 0));
        pool.claim(1, bob, found / 2, _proof(leaves, 1));
        assertEq(token.balanceOf(address(pool)), 0);
        assertTrue(pool.claimed(1, bob));
    }
}
