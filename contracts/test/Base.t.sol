// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ColourcodeMiner} from "../src/ColourcodeMiner.sol";
import {ColourcodePool} from "../src/ColourcodePool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Shared fixtures and helpers (nonce search, merkle trees).
abstract contract Base is Test {
    uint256 internal constant T = 600; // target spacing
    uint256 internal constant HALVING = 12_960;
    uint256 internal constant MIN_HOLD = 1_000e18;
    uint256 internal constant MIN_SPACING = 60;
    uint256 internal constant RESERVE = 10_500_000e18;
    // 1 in 32 hashes wins: fast nonce search in tests (MAX_TARGET = 16x = 2^255).
    uint256 internal constant EASY_TARGET = 1 << 251;
    string internal constant GENESIS = "colour.codes 15/Oct/2026 genesis";

    MockERC20 internal token;
    address internal deployer = makeAddr("deployer");
    address internal alice = makeAddr("alice"); // holder
    address internal bob = makeAddr("bob"); // holder
    address internal carol = makeAddr("carol"); // not a holder
    address internal operator = makeAddr("operator"); // pool server wallet (holder)

    function _newToken() internal returns (MockERC20 t) {
        t = new MockERC20("Mock Colourcode", "mCCODE");
        t.mint(alice, MIN_HOLD);
        t.mint(bob, 5 * MIN_HOLD);
        t.mint(operator, MIN_HOLD);
        t.mint(carol, MIN_HOLD - 1);
    }

    function _deployMiner(uint256 spacing, uint256 halving, uint256 initialTarget, uint256 minSpacing)
        internal
        returns (ColourcodeMiner m)
    {
        vm.prank(deployer);
        m = new ColourcodeMiner(
            IERC20(address(token)), spacing, halving, initialTarget, MIN_HOLD, minSpacing, GENESIS
        );
    }

    function _fundAndStart(ColourcodeMiner m, uint256 reserve) internal {
        token.mint(address(m), reserve);
        vm.prank(deployer);
        m.start();
    }

    function _digest(ColourcodeMiner m, address beneficiary, uint256 nonce) internal view returns (bytes32) {
        (bytes32 challenge,,,,,,,,,) = m.state();
        return keccak256(abi.encodePacked(challenge, beneficiary, nonce));
    }

    function _target(ColourcodeMiner m) internal view returns (uint256 target) {
        (, target,,,,,,,,) = m.state();
    }

    function _height(ColourcodeMiner m) internal view returns (uint256 height) {
        (,, height,,,,,,,) = m.state();
    }

    /// @dev First nonce >= seed whose digest meets the current target for `beneficiary`.
    function _findNonce(ColourcodeMiner m, address beneficiary, uint256 seed)
        internal
        view
        returns (uint256 nonce, bytes32 digest)
    {
        (bytes32 challenge, uint256 target,,,,,,,,) = m.state();
        for (nonce = seed;; ++nonce) {
            digest = keccak256(abi.encodePacked(challenge, beneficiary, nonce));
            if (uint256(digest) <= target) return (nonce, digest);
        }
    }

    /// @dev Waits exactly one target spacing (keeps the target unchanged) and mines a block.
    function _mineBlock(ColourcodeMiner m, address submitter, address beneficiary)
        internal
        returns (uint256 reward)
    {
        vm.warp(block.timestamp + m.TARGET_SPACING());
        (uint256 nonce,) = _findNonce(m, beneficiary, uint256(keccak256(abi.encode(block.timestamp))));
        vm.prank(submitter);
        reward = m.mint(nonce, beneficiary);
    }

    // ------------------------------------------------------------------ merkle (OZ sorted pairs)

    function _leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _nextLayer(bytes32[] memory layer) private pure returns (bytes32[] memory next) {
        next = new bytes32[]((layer.length + 1) / 2);
        for (uint256 i = 0; i < layer.length; i += 2) {
            next[i / 2] = i + 1 < layer.length ? _hashPair(layer[i], layer[i + 1]) : layer[i];
        }
    }

    function _root(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory layer = leaves;
        while (layer.length > 1) layer = _nextLayer(layer);
        return layer[0];
    }

    function _proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory proof) {
        bytes32[] memory tmp = new bytes32[](256);
        uint256 len;
        bytes32[] memory layer = leaves;
        while (layer.length > 1) {
            uint256 sibling = index ^ 1;
            if (sibling < layer.length) tmp[len++] = layer[sibling];
            layer = _nextLayer(layer);
            index /= 2;
        }
        proof = new bytes32[](len);
        for (uint256 i = 0; i < len; ++i) {
            proof[i] = tmp[i];
        }
    }
}
