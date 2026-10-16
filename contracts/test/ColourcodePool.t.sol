// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ColourcodeMiner} from "../src/ColourcodeMiner.sol";
import {ColourcodePool} from "../src/ColourcodePool.sol";
import {Base} from "./Base.t.sol";

contract ColourcodePoolTest is Base {
    ColourcodePool internal pool;
    address internal dave = makeAddr("dave");

    event EpochPosted(uint256 indexed epoch, bytes32 root, uint256 total);
    event Claimed(uint256 indexed epoch, address indexed account, uint256 amount);

    function setUp() public {
        vm.warp(1_800_000_000);
        token = _newToken();
        pool = new ColourcodePool(IERC20(address(token)), operator);
    }

    // 3 accounts: alice 100, bob 250, dave 50 (total 400)
    function _epochLeaves() internal view returns (bytes32[] memory leaves, uint256 total) {
        leaves = new bytes32[](3);
        leaves[0] = _leaf(alice, 100e18);
        leaves[1] = _leaf(bob, 250e18);
        leaves[2] = _leaf(dave, 50e18);
        total = 400e18;
    }

    function _post(uint256 epoch) internal returns (bytes32[] memory leaves) {
        uint256 total;
        (leaves, total) = _epochLeaves();
        vm.prank(operator);
        pool.postEpoch(epoch, _root(leaves), total);
    }

    function test_constructor() public {
        assertEq(address(pool.token()), address(token));
        assertEq(pool.operator(), operator);
        vm.expectRevert(ColourcodePool.InvalidParameter.selector);
        new ColourcodePool(IERC20(address(0)), operator);
        vm.expectRevert(ColourcodePool.InvalidParameter.selector);
        new ColourcodePool(IERC20(address(token)), address(0));
    }

    function test_leafMatchesOpenZeppelinStandardFormat() public pure {
        // StandardMerkleTree leaf for ["address","uint256"] values
        address account = 0x1111111111111111111111111111111111111111;
        uint256 amount = 5e18;
        bytes32 expected = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        bytes32[] memory leaves = new bytes32[](1);
        leaves[0] = expected;
        assertEq(_root(leaves), expected); // single leaf tree: root == leaf, empty proof
    }

    function test_postAndClaim_happyPath() public {
        token.mint(address(pool), 1_000e18);
        (bytes32[] memory leaves, uint256 total) = _epochLeaves();
        bytes32 root = _root(leaves);

        vm.expectEmit(address(pool));
        emit EpochPosted(1, root, total);
        vm.prank(operator);
        pool.postEpoch(1, root, total);

        assertEq(pool.epochRoot(1), root);
        assertEq(pool.epochTotal(1), total);
        assertEq(pool.outstanding(), total);
        assertEq(pool.unallocated(), 600e18);
        assertEq(pool.epochCount(), 1);

        uint256 bobBefore = token.balanceOf(bob);
        vm.expectEmit(address(pool));
        emit Claimed(1, bob, 250e18);
        // anyone may relay a claim; tokens go to the account
        vm.prank(carol);
        pool.claim(1, bob, 250e18, _proof(leaves, 1));

        assertEq(token.balanceOf(bob), bobBefore + 250e18);
        assertTrue(pool.claimed(1, bob));
        assertFalse(pool.claimed(1, alice));
        assertEq(pool.outstanding(), 150e18);
        assertEq(pool.epochClaimed(1), 250e18);
        assertEq(pool.unallocated(), 600e18); // claims do not change what is unallocated

        vm.prank(alice);
        pool.claim(1, alice, 100e18, _proof(leaves, 0));
        vm.prank(dave);
        pool.claim(1, dave, 50e18, _proof(leaves, 2));
        assertEq(pool.outstanding(), 0);
        assertEq(token.balanceOf(address(pool)), 600e18);
        assertEq(pool.unallocated(), 600e18);
    }

    function test_claim_badProofReverts() public {
        token.mint(address(pool), 1_000e18);
        bytes32[] memory leaves = _post(1);

        // wrong amount
        bytes32[] memory proof = _proof(leaves, 0);
        vm.expectRevert(ColourcodePool.InvalidProof.selector);
        pool.claim(1, alice, 101e18, proof);
        // wrong account with alice's proof
        vm.expectRevert(ColourcodePool.InvalidProof.selector);
        pool.claim(1, carol, 100e18, proof);
        // someone else's proof
        vm.expectRevert(ColourcodePool.InvalidProof.selector);
        pool.claim(1, alice, 100e18, _proof(leaves, 1));
        // empty proof
        vm.expectRevert(ColourcodePool.InvalidProof.selector);
        pool.claim(1, alice, 100e18, new bytes32[](0));
        // tampered proof element
        proof[0] = bytes32(uint256(proof[0]) ^ 1);
        vm.expectRevert(ColourcodePool.InvalidProof.selector);
        pool.claim(1, alice, 100e18, proof);

        assertFalse(pool.claimed(1, alice));
        assertEq(pool.outstanding(), 400e18);
    }

    function test_claim_doubleClaimReverts() public {
        token.mint(address(pool), 1_000e18);
        bytes32[] memory leaves = _post(1);
        bytes32[] memory proof = _proof(leaves, 0);
        pool.claim(1, alice, 100e18, proof);
        vm.expectRevert(abi.encodeWithSelector(ColourcodePool.AlreadyClaimed.selector, 1, alice));
        pool.claim(1, alice, 100e18, proof);
        assertEq(token.balanceOf(alice), MIN_HOLD + 100e18);
    }

    function test_claim_unknownEpochReverts() public {
        vm.expectRevert(abi.encodeWithSelector(ColourcodePool.EpochUnknown.selector, 7));
        pool.claim(7, alice, 1, new bytes32[](0));
    }

    function test_post_overAllocationReverts() public {
        token.mint(address(pool), 399e18);
        (bytes32[] memory leaves, uint256 total) = _epochLeaves();
        bytes32 root = _root(leaves);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(ColourcodePool.OverAllocation.selector, total, 399e18));
        pool.postEpoch(1, root, total);

        // exactly the balance is fine
        token.mint(address(pool), 1e18);
        vm.prank(operator);
        pool.postEpoch(1, root, total);
        assertEq(pool.unallocated(), 0);

        // the next epoch can not reuse allocated tokens, even before they are claimed
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(ColourcodePool.OverAllocation.selector, 1, 0));
        pool.postEpoch(2, root, 1);

        // nor after claims (claimed tokens left the pool)
        pool.claim(1, bob, 250e18, _proof(leaves, 1));
        assertEq(pool.unallocated(), 0);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(ColourcodePool.OverAllocation.selector, 1, 0));
        pool.postEpoch(2, root, 1);
    }

    function test_post_nonOperatorReverts() public {
        token.mint(address(pool), 1_000e18);
        (bytes32[] memory leaves, uint256 total) = _epochLeaves();
        bytes32 root = _root(leaves);
        address[3] memory others = [alice, deployer, address(this)];
        for (uint256 i = 0; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(ColourcodePool.NotOperator.selector);
            pool.postEpoch(1, root, total);
        }
    }

    function test_post_epochCanNotBeOverwritten() public {
        token.mint(address(pool), 1_000e18);
        _post(1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(ColourcodePool.EpochExists.selector, 1));
        pool.postEpoch(1, keccak256("other"), 1e18);
    }

    function test_post_rejectsEmptyRootOrTotal() public {
        token.mint(address(pool), 1_000e18);
        vm.startPrank(operator);
        vm.expectRevert(ColourcodePool.InvalidParameter.selector);
        pool.postEpoch(1, bytes32(0), 1e18);
        vm.expectRevert(ColourcodePool.InvalidParameter.selector);
        pool.postEpoch(1, keccak256("root"), 0);
        vm.stopPrank();
    }

    /// A buggy root whose leaves add up to more than the posted total can never drain other epochs.
    function test_claim_capsAtEpochTotal() public {
        token.mint(address(pool), 1_000e18);
        (bytes32[] memory leaves,) = _epochLeaves(); // leaves sum to 400
        vm.prank(operator);
        pool.postEpoch(1, _root(leaves), 300e18); // but only 300 allocated
        pool.claim(1, bob, 250e18, _proof(leaves, 1));
        vm.expectRevert(abi.encodeWithSelector(ColourcodePool.EpochExhausted.selector, 1));
        pool.claim(1, alice, 100e18, _proof(leaves, 0));
        pool.claim(1, dave, 50e18, _proof(leaves, 2));
        assertEq(pool.outstanding(), 0);
        assertEq(pool.unallocated(), 700e18);
    }

    function test_multiEpoch() public {
        token.mint(address(pool), 500e18);
        bytes32[] memory e1 = _post(1); // 400 allocated, 100 free
        assertEq(pool.unallocated(), 100e18);

        // more block rewards arrive
        token.mint(address(pool), 300e18);
        bytes32[] memory e2 = new bytes32[](2);
        e2[0] = _leaf(alice, 300e18);
        e2[1] = _leaf(carol, 100e18);
        vm.prank(operator);
        pool.postEpoch(2, _root(e2), 400e18);
        assertEq(pool.unallocated(), 0);
        assertEq(pool.outstanding(), 800e18);
        assertEq(pool.epochCount(), 2);

        // the same account claims in both epochs independently
        pool.claim(2, alice, 300e18, _proof(e2, 0));
        assertTrue(pool.claimed(2, alice));
        assertFalse(pool.claimed(1, alice));
        pool.claim(1, alice, 100e18, _proof(e1, 0));
        assertTrue(pool.claimed(1, alice));

        // a proof from epoch 2 is not valid in epoch 1
        vm.expectRevert(ColourcodePool.InvalidProof.selector);
        pool.claim(1, carol, 100e18, _proof(e2, 1));

        pool.claim(2, carol, 100e18, _proof(e2, 1));
        pool.claim(1, bob, 250e18, _proof(e1, 1));
        pool.claim(1, dave, 50e18, _proof(e1, 2));
        assertEq(pool.outstanding(), 0);
        assertEq(token.balanceOf(address(pool)), 0);
        assertEq(token.balanceOf(alice), MIN_HOLD + 400e18);

        // epochs do not have to be sequential, but each number is single use
        token.mint(address(pool), 10e18);
        bytes32[] memory e9 = new bytes32[](1);
        e9[0] = _leaf(dave, 10e18);
        vm.prank(operator);
        pool.postEpoch(9, _root(e9), 10e18);
        pool.claim(9, dave, 10e18, new bytes32[](0));
        assertEq(pool.epochCount(), 3);
    }

    function test_largeTreeProofs() public {
        uint256 n = 37;
        bytes32[] memory leaves = new bytes32[](n);
        uint256 total;
        for (uint256 i = 0; i < n; ++i) {
            leaves[i] = _leaf(address(uint160(0x1000 + i)), (i + 1) * 1e18);
            total += (i + 1) * 1e18;
        }
        token.mint(address(pool), total);
        vm.prank(operator);
        pool.postEpoch(1, _root(leaves), total);
        for (uint256 i = 0; i < n; ++i) {
            bytes32[] memory proof = _proof(leaves, i);
            assertTrue(MerkleProof.verify(proof, _root(leaves), leaves[i]));
            pool.claim(1, address(uint160(0x1000 + i)), (i + 1) * 1e18, proof);
        }
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function test_noOtherWithdraw() public {
        token.mint(address(pool), 1_000e18);
        bytes[] memory calls = new bytes[](6);
        calls[0] = abi.encodeWithSignature("withdraw()");
        calls[1] = abi.encodeWithSignature("withdraw(uint256)", 1);
        calls[2] = abi.encodeWithSignature("sweep(address)", operator);
        calls[3] = abi.encodeWithSignature("setOperator(address)", alice);
        calls[4] = abi.encodeWithSignature("transferOwnership(address)", alice);
        calls[5] = "";
        for (uint256 i = 0; i < calls.length; ++i) {
            vm.prank(operator);
            (bool ok,) = address(pool).call(calls[i]);
            assertFalse(ok);
        }
        assertEq(token.balanceOf(address(pool)), 1_000e18);
    }

    /// End to end: pool miners find blocks with the pool as beneficiary, operator posts, miners claim.
    function test_integration_minerToPool() public {
        ColourcodeMiner miner = _deployMiner(T, HALVING, EASY_TARGET, MIN_SPACING);
        _fundAndStart(miner, RESERVE);

        uint256 found;
        for (uint256 i = 0; i < 3; ++i) {
            found += _mineBlock(miner, operator, address(pool)); // operator wallet submits winning shares
        }
        assertEq(token.balanceOf(address(pool)), found);
        assertEq(pool.unallocated(), found);

        // split 60/40 between alice and bob (by shares), remainder stays unallocated
        uint256 a = found * 60 / 100;
        uint256 b = found * 40 / 100;
        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = _leaf(alice, a);
        leaves[1] = _leaf(bob, b);
        vm.prank(operator);
        pool.postEpoch(1, _root(leaves), a + b);

        pool.claim(1, alice, a, _proof(leaves, 0));
        pool.claim(1, bob, b, _proof(leaves, 1));
        assertEq(token.balanceOf(alice), MIN_HOLD + a);
        assertEq(token.balanceOf(bob), 5 * MIN_HOLD + b);
        assertEq(pool.unallocated(), found - a - b);
    }
}
