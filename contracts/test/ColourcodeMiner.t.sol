// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ColourcodeMiner} from "../src/ColourcodeMiner.sol";
import {Base} from "./Base.t.sol";

contract ColourcodeMinerTest is Base {
    ColourcodeMiner internal miner;

    event Started(uint256 initialReward, uint256 reserve, uint256 startTime);
    event Mined(
        uint256 indexed height,
        address indexed miner,
        address indexed beneficiary,
        uint256 reward,
        bytes32 digest,
        uint256 newTarget,
        uint256 timestamp
    );

    function setUp() public {
        vm.warp(1_800_000_000);
        token = _newToken();
        miner = _deployMiner(T, HALVING, EASY_TARGET, MIN_SPACING);
    }

    // ------------------------------------------------------------------ deployment / start

    function test_constructor_setsParametersAndGenesis() public view {
        assertEq(address(miner.token()), address(token));
        assertEq(miner.TARGET_SPACING(), T);
        assertEq(miner.HALVING_INTERVAL(), HALVING);
        assertEq(miner.INITIAL_TARGET(), EASY_TARGET);
        assertEq(miner.MAX_TARGET(), EASY_TARGET * 16);
        assertEq(miner.MIN_HOLD(), MIN_HOLD);
        assertEq(miner.MIN_SPACING(), MIN_SPACING);
        assertEq(miner.DEPLOYER(), deployer);
        assertEq(miner.genesisMessage(), GENESIS);

        bytes32 expected = keccak256(abi.encode(block.chainid, keccak256(bytes(GENESIS))));
        assertEq(miner.GENESIS_CHALLENGE(), expected);

        (
            bytes32 challenge,
            uint256 target,
            uint256 height,
            uint256 reward,
            uint256 lastBlockTime,
            uint256 reserve,
            uint256 minHold,
            uint256 minSpacing,
            uint256 startTime,
            bool started
        ) = miner.state();
        assertEq(challenge, expected);
        assertEq(target, EASY_TARGET);
        assertEq(height, 0);
        assertEq(reward, 0);
        assertEq(lastBlockTime, 0);
        assertEq(reserve, 0);
        assertEq(minHold, MIN_HOLD);
        assertEq(minSpacing, MIN_SPACING);
        assertEq(startTime, 0);
        assertFalse(started);
    }

    function test_constructor_rejectsBadParameters() public {
        IERC20 t = IERC20(address(token));
        vm.expectRevert(ColourcodeMiner.InvalidParameter.selector);
        new ColourcodeMiner(IERC20(address(0)), T, HALVING, EASY_TARGET, MIN_HOLD, MIN_SPACING, GENESIS);
        vm.expectRevert(ColourcodeMiner.InvalidParameter.selector);
        new ColourcodeMiner(t, 3, HALVING, EASY_TARGET, MIN_HOLD, 1, GENESIS);
        vm.expectRevert(ColourcodeMiner.InvalidParameter.selector);
        new ColourcodeMiner(t, T, 0, EASY_TARGET, MIN_HOLD, MIN_SPACING, GENESIS);
        vm.expectRevert(ColourcodeMiner.InvalidParameter.selector);
        new ColourcodeMiner(t, T, HALVING, 0, MIN_HOLD, MIN_SPACING, GENESIS);
        vm.expectRevert(ColourcodeMiner.InvalidParameter.selector);
        new ColourcodeMiner(t, T, HALVING, EASY_TARGET, MIN_HOLD, T + 1, GENESIS);
        vm.expectRevert(ColourcodeMiner.InvalidParameter.selector);
        new ColourcodeMiner(t, T, HALVING, EASY_TARGET, MIN_HOLD, MIN_SPACING, "");
    }

    function test_maxTargetSaturates() public {
        ColourcodeMiner m = _deployMiner(T, HALVING, type(uint256).max, MIN_SPACING);
        assertEq(m.MAX_TARGET(), type(uint256).max);
    }

    function test_start_fixesScheduleAndEmits() public {
        token.mint(address(miner), RESERVE);
        vm.expectEmit(address(miner));
        emit Started(RESERVE / (2 * HALVING), RESERVE, block.timestamp);
        vm.prank(deployer);
        miner.start();

        assertEq(miner.initialReward(), RESERVE / (2 * HALVING));
        (,,, uint256 reward, uint256 lastBlockTime, uint256 reserve,,, uint256 startTime, bool started) =
            miner.state();
        assertTrue(started);
        assertEq(startTime, block.timestamp);
        assertEq(lastBlockTime, block.timestamp);
        assertEq(reserve, RESERVE);
        assertEq(reward, RESERVE / (2 * HALVING));
    }

    function test_start_onlyDeployer() public {
        token.mint(address(miner), RESERVE);
        vm.prank(alice);
        vm.expectRevert(ColourcodeMiner.NotDeployer.selector);
        miner.start();
    }

    function test_start_requiresReserve() public {
        token.mint(address(miner), 2 * HALVING - 1);
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(ColourcodeMiner.ReserveTooSmall.selector, 2 * HALVING - 1, 2 * HALVING)
        );
        miner.start();
    }

    function test_mint_beforeStartReverts() public {
        (uint256 nonce,) = _findNonce(miner, alice, 0);
        vm.prank(alice);
        vm.expectRevert(ColourcodeMiner.NotStarted.selector);
        miner.mint(nonce, alice);
    }

    // ------------------------------------------------------------------ happy path

    function test_mint_happyPath() public {
        _fundAndStart(miner, RESERVE);
        uint256 startTs = block.timestamp;
        vm.warp(startTs + T); // exactly on schedule -> target unchanged

        (bytes32 challengeBefore,,,,,,,,,) = miner.state();
        (uint256 nonce, bytes32 digest) = _findNonce(miner, alice, 0);
        uint256 expectedReward = RESERVE / (2 * HALVING);

        vm.expectEmit(address(miner));
        emit Mined(1, alice, alice, expectedReward, digest, EASY_TARGET, block.timestamp);
        vm.prank(alice);
        uint256 reward = miner.mint(nonce, alice);

        assertEq(reward, expectedReward);
        assertEq(token.balanceOf(alice), MIN_HOLD + expectedReward);
        (bytes32 challenge, uint256 target, uint256 height,, uint256 lastBlockTime, uint256 reserve,,,,) =
            miner.state();
        assertEq(height, 1);
        assertEq(target, EASY_TARGET);
        assertEq(lastBlockTime, startTs + T);
        assertEq(reserve, RESERVE - expectedReward);
        assertEq(challenge, keccak256(abi.encodePacked(challengeBefore, digest, uint256(0))));
        assertEq(miner.digestOf(alice, nonce), keccak256(abi.encodePacked(challenge, alice, nonce)));
    }

    function test_mint_digestIs84BytePacked() public {
        _fundAndStart(miner, RESERVE);
        (bytes32 challenge,,,,,,,,,) = miner.state();
        bytes memory packed = abi.encodePacked(challenge, alice, uint256(42));
        assertEq(packed.length, 84);
        assertEq(miner.digestOf(alice, 42), keccak256(packed));
    }

    function test_mint_submitterDiffersFromBeneficiary() public {
        _fundAndStart(miner, RESERVE);
        vm.warp(block.timestamp + T);
        (uint256 nonce,) = _findNonce(miner, carol, 0); // carol is not a holder but may receive
        vm.prank(operator);
        uint256 reward = miner.mint(nonce, carol);
        assertEq(token.balanceOf(carol), MIN_HOLD - 1 + reward);
    }

    function test_mint_challengeChainsEveryBlock() public {
        _fundAndStart(miner, RESERVE);
        bytes32 prev = miner.GENESIS_CHALLENGE();
        for (uint256 i = 0; i < 5; ++i) {
            vm.warp(block.timestamp + T);
            (uint256 nonce, bytes32 digest) = _findNonce(miner, alice, i * 1000);
            vm.prank(alice);
            miner.mint(nonce, alice);
            (bytes32 next,,,,,,,,,) = miner.state();
            assertEq(next, keccak256(abi.encodePacked(prev, digest, i)));
            prev = next;
        }
        // the same nonce can not be replayed against the new challenge (unless it wins again by chance)
        assertEq(_height(miner), 5);
    }

    // ------------------------------------------------------------------ rejections

    function test_mint_wrongNonceReverts() public {
        _fundAndStart(miner, RESERVE);
        vm.warp(block.timestamp + T);
        uint256 target = _target(miner);
        uint256 nonce;
        bytes32 digest;
        for (nonce = 0;; ++nonce) {
            digest = _digest(miner, alice, nonce);
            if (uint256(digest) > target) break;
        }
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ColourcodeMiner.HashAboveTarget.selector, digest, target));
        miner.mint(nonce, alice);
    }

    function test_mint_nonHolderReverts() public {
        _fundAndStart(miner, RESERVE);
        vm.warp(block.timestamp + T);
        (uint256 nonce,) = _findNonce(miner, carol, 0);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ColourcodeMiner.NotHolder.selector, MIN_HOLD - 1, MIN_HOLD));
        miner.mint(nonce, carol);
    }

    function test_mint_exactlyMinHoldIsEnough() public {
        _fundAndStart(miner, RESERVE);
        vm.warp(block.timestamp + T);
        assertEq(token.balanceOf(alice), MIN_HOLD);
        (uint256 nonce,) = _findNonce(miner, alice, 0);
        vm.prank(alice);
        miner.mint(nonce, alice);
    }

    function test_mint_tooEarlyReverts() public {
        _fundAndStart(miner, RESERVE);
        uint256 startTs = block.timestamp;

        // first block can not come before start + minSpacing
        vm.warp(startTs + MIN_SPACING - 1);
        (uint256 nonce,) = _findNonce(miner, alice, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ColourcodeMiner.TooEarly.selector, startTs + MIN_SPACING));
        miner.mint(nonce, alice);

        vm.warp(startTs + MIN_SPACING);
        vm.prank(alice);
        miner.mint(nonce, alice);

        // and the next one not before lastBlockTime + minSpacing
        uint256 last = block.timestamp;
        vm.warp(last + MIN_SPACING - 1);
        (nonce,) = _findNonce(miner, bob, 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ColourcodeMiner.TooEarly.selector, last + MIN_SPACING));
        miner.mint(nonce, bob);
    }

    function test_mint_zeroBeneficiaryReverts() public {
        _fundAndStart(miner, RESERVE);
        vm.warp(block.timestamp + T);
        vm.prank(alice);
        vm.expectRevert(ColourcodeMiner.ZeroBeneficiary.selector);
        miner.mint(0, address(0));
    }

    /// A nonce found for alice is worthless to bob: the beneficiary is part of the hash.
    function test_mint_copiedNonceWithOtherBeneficiaryFails() public {
        _fundAndStart(miner, RESERVE);
        vm.warp(block.timestamp + T);
        uint256 target = _target(miner);

        // a nonce that wins for alice but (as almost always on a real target) not for bob
        uint256 nonce;
        for (nonce = 0;; ++nonce) {
            if (
                uint256(_digest(miner, alice, nonce)) <= target
                    && uint256(_digest(miner, bob, nonce)) > target
            ) {
                break;
            }
        }

        bytes32 bobDigest = _digest(miner, bob, nonce);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ColourcodeMiner.HashAboveTarget.selector, bobDigest, target));
        miner.mint(nonce, bob);

        // a front-runner can only submit it with alice as beneficiary, which pays alice
        uint256 aliceBefore = token.balanceOf(alice);
        uint256 bobBefore = token.balanceOf(bob);
        vm.prank(bob);
        uint256 reward = miner.mint(nonce, alice);
        assertEq(token.balanceOf(alice), aliceBefore + reward);
        assertEq(token.balanceOf(bob), bobBefore);
    }

    // ------------------------------------------------------------------ halving

    function test_halving_boundaries() public {
        uint256 interval = 4;
        ColourcodeMiner m = _deployMiner(T, interval, EASY_TARGET, MIN_SPACING);
        uint256 reserve = 1_000_000e18;
        _fundAndStart(m, reserve);
        uint256 r0 = reserve / (2 * interval);
        assertEq(m.initialReward(), r0);

        for (uint256 h = 0; h < 4 * interval; ++h) {
            (,,, uint256 shown,,,,,,) = m.state();
            uint256 expected = r0 >> (h / interval);
            assertEq(shown, expected, "state().reward");
            assertEq(m.nextHalvingAt(), (h / interval + 1) * interval);
            uint256 paid = _mineBlock(m, alice, alice);
            assertEq(paid, expected, "paid reward");
        }
        // height 16 -> era 4
        (,,, uint256 rewardNow,,,,,,) = m.state();
        assertEq(rewardNow, r0 >> 4);
    }

    function test_halving_productionInterval() public {
        _fundAndStart(miner, RESERVE);
        uint256 r0 = RESERVE / (2 * HALVING);
        // jump to the last block of era 0 by mining is too slow; check the schedule through state() math
        assertEq(miner.nextHalvingAt(), HALVING);
        _mineBlock(miner, alice, alice);
        (,,, uint256 reward,,,,,,) = miner.state();
        assertEq(reward, r0);
        // geometric series of the full schedule never exceeds the reserve
        uint256 total;
        for (uint256 era = 0; era < 256; ++era) {
            total += (r0 >> era) * HALVING;
        }
        assertLe(total, RESERVE);
        assertGt(total, RESERVE - RESERVE / 1e15); // ~= reserve
    }

    // ------------------------------------------------------------------ reserve exhaustion

    function test_reserve_naturalEndOfEmission() public {
        ColourcodeMiner m = _deployMiner(T, 1, EASY_TARGET, MIN_SPACING);
        _fundAndStart(m, 1000); // initialReward = 500 wei, halves every block
        uint256 paidTotal;
        uint256[9] memory expected = [uint256(500), 250, 125, 62, 31, 15, 7, 3, 1];
        for (uint256 i = 0; i < expected.length; ++i) {
            uint256 paid = _mineBlock(m, alice, bob);
            assertEq(paid, expected[i]);
            paidTotal += paid;
        }
        assertEq(paidTotal, 994);
        (,,, uint256 reward,,,,,,) = m.state();
        assertEq(reward, 0);

        vm.warp(block.timestamp + T);
        (uint256 nonce,) = _findNonce(m, bob, 0);
        vm.prank(alice);
        vm.expectRevert(ColourcodeMiner.EmissionComplete.selector);
        m.mint(nonce, bob);
        // dust stays in the vault forever
        assertEq(token.balanceOf(address(m)), 6);
    }

    function test_reserve_rewardCappedAtBalance() public {
        ColourcodeMiner m = _deployMiner(T, 1, EASY_TARGET, MIN_SPACING);
        _fundAndStart(m, 1000);
        // simulate a vault balance below the schedule (e.g. a deflationary token)
        token.burn(address(m), 900);
        (,,, uint256 shown,,,,,,) = m.state();
        assertEq(shown, 100);
        uint256 paid = _mineBlock(m, alice, alice);
        assertEq(paid, 100);
        assertEq(token.balanceOf(address(m)), 0);

        vm.warp(block.timestamp + T);
        (uint256 nonce,) = _findNonce(m, alice, 0);
        vm.prank(alice);
        vm.expectRevert(ColourcodeMiner.EmissionComplete.selector);
        m.mint(nonce, alice);
    }

    // ------------------------------------------------------------------ retarget

    function test_retarget_onScheduleUnchanged() public view {
        assertEq(miner.nextTarget(EASY_TARGET, T), EASY_TARGET);
    }

    function test_retarget_fastBlockClampsAt13Over16() public view {
        uint256 expected = EASY_TARGET / 16 * 13;
        assertEq(miner.nextTarget(EASY_TARGET, 0), expected);
        assertEq(miner.nextTarget(EASY_TARGET, T / 4), expected);
        assertEq(miner.nextTarget(EASY_TARGET, T / 4 - 1), expected);
    }

    function test_retarget_slowBlockClampsAt7Over4() public view {
        uint256 base = EASY_TARGET / 8;
        uint256 expected = base / 4 * 7;
        assertEq(miner.nextTarget(base, 4 * T), expected);
        assertEq(miner.nextTarget(base, 4 * T + 1), expected);
        assertEq(miner.nextTarget(base, 365 days), expected);
    }

    function test_retarget_cappedAtMaxTarget() public view {
        uint256 maxT = miner.MAX_TARGET();
        assertEq(miner.nextTarget(maxT, 4 * T), maxT);
        assertEq(miner.nextTarget(maxT - 1, 10 * T), maxT);
    }

    function test_retarget_flooredAtOne() public view {
        assertEq(miner.nextTarget(1, 0), 1);
    }

    function test_retarget_noOverflowNearUint256Max() public {
        ColourcodeMiner m = _deployMiner(T, HALVING, type(uint256).max, MIN_SPACING);
        assertEq(m.nextTarget(type(uint256).max, 4 * T), type(uint256).max);
        assertEq(m.nextTarget(type(uint256).max, T), type(uint256).max);
        assertEq(m.nextTarget(type(uint256).max, 0), Math.mulDiv(type(uint256).max, 13, 16));
    }

    function test_retarget_appliedOnMint() public {
        _fundAndStart(miner, RESERVE);
        // fast block (60 s, clamped to T/4) -> harder
        vm.warp(block.timestamp + MIN_SPACING);
        (uint256 nonce,) = _findNonce(miner, alice, 0);
        vm.prank(alice);
        miner.mint(nonce, alice);
        assertEq(_target(miner), EASY_TARGET / 16 * 13);

        // very slow block -> easier
        uint256 before = _target(miner);
        vm.warp(block.timestamp + 10 * T);
        (nonce,) = _findNonce(miner, alice, 0);
        vm.prank(alice);
        miner.mint(nonce, alice);
        assertEq(_target(miner), Math.mulDiv(before, 7, 4));
    }

    /// With a constant hashrate, the damped retarget converges to the target that gives T-second blocks.
    function test_retarget_convergesToSpacing() public view {
        uint256 ideal = EASY_TARGET; // the target at which the network averages T seconds per block
        uint256 target = ideal / 8; // launch guess 8x too hard
        for (uint256 i = 0; i < 40; ++i) {
            uint256 dt = Math.mulDiv(T, ideal, target); // expected block time at this difficulty
            target = miner.nextTarget(target, dt);
        }
        uint256 diff = target > ideal ? target - ideal : ideal - target;
        assertLt(diff, ideal / 100); // within 1 %
    }

    function testFuzz_retargetBounds(uint256 spacing, uint256 initialTarget, uint256 current, uint256 elapsed)
        public
    {
        spacing = bound(spacing, 4, 365 days);
        initialTarget = bound(initialTarget, 1, type(uint256).max);
        ColourcodeMiner m = _deployMiner(spacing, HALVING, initialTarget, spacing / 10);
        uint256 maxT = m.MAX_TARGET();
        current = bound(current, 1, maxT);

        uint256 next = m.nextTarget(current, elapsed);

        // never above the cap, never zero
        assertLe(next, maxT);
        assertGe(next, 1);
        // exact value, computed independently without 512-bit math
        assertEq(next, _expectedNext(spacing, maxT, current, elapsed));
        // at most 1.75x easier, at least (3T + T/4)/4T of the previous target (13/16 when 4 | T)
        if (current <= type(uint256).max / 7) assertLe(next, Math.max(1, current * 7 / 4));
        assertGe(next, Math.max(1, Math.mulDiv(current, 3 * spacing + spacing / 4, 4 * spacing)));
        if (spacing % 4 == 0) assertGe(next, Math.max(1, Math.mulDiv(current, 13, 16)));
    }

    function _expectedNext(uint256 spacing, uint256 maxT, uint256 current, uint256 elapsed)
        internal
        pure
        returns (uint256 expected)
    {
        uint256 lo = spacing / 4;
        uint256 hi = spacing * 4;
        uint256 dt = elapsed < lo ? lo : (elapsed > hi ? hi : elapsed);
        uint256 num = 3 * spacing + dt;
        uint256 den = 4 * spacing;
        // the clamp keeps the factor within [(3T + T/4)/4T, 7/4]
        assertGe(num, 3 * spacing + lo);
        if (spacing % 4 == 0) assertGe(num * 16, den * 13);
        assertLe(num * 4, den * 7);

        uint256 q = current / den;
        uint256 r = current % den;
        if (q > type(uint256).max / num) {
            expected = maxT;
        } else {
            uint256 a = q * num;
            uint256 b = (r * num) / den;
            expected = a > type(uint256).max - b ? maxT : a + b;
            if (expected > maxT) expected = maxT;
        }
        if (expected == 0) expected = 1;
    }

    function testFuzz_retargetMonotonicInElapsed(uint256 current, uint256 e1, uint256 e2) public view {
        current = bound(current, 1, miner.MAX_TARGET());
        e1 = bound(e1, 0, 100 * T);
        e2 = bound(e2, e1, 100 * T);
        assertLe(miner.nextTarget(current, e1), miner.nextTarget(current, e2));
    }

    // ------------------------------------------------------------------ no owner powers

    function test_noOwnerPowersAfterStart() public {
        _fundAndStart(miner, RESERVE);

        // start can not be repeated by anyone
        vm.prank(deployer);
        vm.expectRevert(ColourcodeMiner.AlreadyStarted.selector);
        miner.start();

        // no admin entry points exist (no fallback either)
        bytes[] memory calls = new bytes[](12);
        calls[0] = abi.encodeWithSignature("withdraw()");
        calls[1] = abi.encodeWithSignature("withdraw(uint256)", 1);
        calls[2] = abi.encodeWithSignature("withdraw(address,uint256)", deployer, 1);
        calls[3] = abi.encodeWithSignature("emergencyWithdraw()");
        calls[4] = abi.encodeWithSignature("rescueTokens(address,uint256)", address(token), 1);
        calls[5] = abi.encodeWithSignature("pause()");
        calls[6] = abi.encodeWithSignature("unpause()");
        calls[7] = abi.encodeWithSignature("transferOwnership(address)", deployer);
        calls[8] = abi.encodeWithSignature("setTarget(uint256)", type(uint256).max);
        calls[9] = abi.encodeWithSignature("setMinHold(uint256)", 0);
        calls[10] = abi.encodeWithSignature("owner()");
        calls[11] = "";
        for (uint256 i = 0; i < calls.length; ++i) {
            vm.prank(deployer);
            (bool ok,) = address(miner).call(calls[i]);
            assertFalse(ok);
        }
        // and plain ETH can not be sent in either
        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        (bool sent,) = address(miner).call{value: 1}("");
        assertFalse(sent);

        // the vault balance is untouched by the deployer: only mint moves tokens
        assertEq(token.balanceOf(address(miner)), RESERVE);
        uint256 paid = _mineBlock(miner, alice, alice);
        assertEq(token.balanceOf(address(miner)), RESERVE - paid);
    }

    // ------------------------------------------------------------------ reentrancy guard

    function test_mint_reentrancyBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        vm.prank(deployer);
        ColourcodeMiner m = new ColourcodeMiner(IERC20(address(evil)), T, 1, EASY_TARGET, 0, MIN_SPACING, GENESIS);
        evil.mint(address(m), 1000);
        vm.prank(deployer);
        m.start();
        evil.arm(m);

        vm.warp(block.timestamp + T);
        (uint256 nonce,) = _findNonce(m, alice, 0);
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        m.mint(nonce, alice);
    }
}

/// @dev Token that tries to re-enter mint() during the reward transfer.
contract ReentrantToken is ERC20 {
    ColourcodeMiner internal target;

    constructor() ERC20("Evil", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(ColourcodeMiner m) external {
        target = m;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (address(target) != address(0) && from == address(target)) {
            target.mint(0, to);
        }
    }
}
