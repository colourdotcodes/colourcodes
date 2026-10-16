// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ColourcodeMiner
/// @notice Proof-of-work emission of the project token, Bitcoin style.
///
///         The contract is a keyless vault: the block-reward reserve is transferred in once and can only
///         leave as block rewards. Nobody (including the deployer) can withdraw, pause or change parameters.
///         The deployer's single power is the one-time `start()` call after the reserve is funded.
///
///         Mining:  digest = keccak256(abi.encodePacked(challenge, beneficiary, nonce))  (32 + 20 + 32 = 84 bytes)
///                  a block is valid when uint256(digest) <= target.
///         Binding the beneficiary into the digest makes a copied nonce worthless to anybody else.
///         The submitter (msg.sender) must hold at least MIN_HOLD tokens; nothing is ever deposited.
///
///         Difficulty is retargeted every block with a damped rule:
///             dt     = clamp(now - lastBlockTime, T/4, 4T)
///             target = target * (3T + dt) / (4T)          capped at MAX_TARGET, floored at 1
///         Reward halves every HALVING_INTERVAL blocks: reward = initialReward >> (height / HALVING_INTERVAL),
///         where initialReward = reserve / (2 * HALVING_INTERVAL) so the geometric series ~= reserve.
contract ColourcodeMiner is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants / immutables

    /// @notice How much easier than the launch difficulty the target may ever become (MAX_TARGET = 16 x initial).
    uint256 public constant MAX_TARGET_FACTOR = 16;

    /// @notice The token that is mined (and that a submitter must hold).
    IERC20 public immutable token;
    /// @notice Desired seconds between blocks (T).
    uint256 public immutable TARGET_SPACING;
    /// @notice Blocks per reward era; the reward halves at every multiple of this height.
    uint256 public immutable HALVING_INTERVAL;
    /// @notice Target at launch (block 1 difficulty).
    uint256 public immutable INITIAL_TARGET;
    /// @notice Easiest target the retarget may ever reach.
    uint256 public immutable MAX_TARGET;
    /// @notice Minimum token balance of msg.sender to submit a block.
    uint256 public immutable MIN_HOLD;
    /// @notice Minimum seconds between two blocks.
    uint256 public immutable MIN_SPACING;
    /// @notice Account allowed to call `start()` once. Has no other power.
    address public immutable DEPLOYER;
    /// @notice First challenge: keccak256(abi.encode(chainid, keccak256(bytes(genesisMessage)))). Fixed and public.
    bytes32 public immutable GENESIS_CHALLENGE;

    /// @notice Headline of the genesis block, like Bitcoin's coinbase message.
    string public genesisMessage;

    // ------------------------------------------------------------------ mutable chain state

    /// @notice Block reward of era 0, fixed by `start()`.
    uint256 public initialReward;

    bytes32 private _challenge;
    uint256 private _target;
    uint256 private _height;
    uint256 private _lastBlockTime;
    uint256 private _startTime;
    bool private _started;

    // ------------------------------------------------------------------ events / errors

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

    error InvalidParameter();
    error NotDeployer();
    error AlreadyStarted();
    error ReserveTooSmall(uint256 reserve, uint256 required);
    error NotStarted();
    error ZeroBeneficiary();
    error TooEarly(uint256 earliest);
    error NotHolder(uint256 balance, uint256 minHold);
    error HashAboveTarget(bytes32 digest, uint256 target);
    error EmissionComplete();

    // ------------------------------------------------------------------ constructor

    constructor(
        IERC20 token_,
        uint256 targetSpacing_,
        uint256 halvingInterval_,
        uint256 initialTarget_,
        uint256 minHold_,
        uint256 minSpacing_,
        string memory genesisMessage_
    ) {
        if (
            address(token_) == address(0) || targetSpacing_ < 4 || targetSpacing_ > 365 days
                || halvingInterval_ == 0 || halvingInterval_ > type(uint128).max || initialTarget_ == 0
                || minSpacing_ > targetSpacing_ || bytes(genesisMessage_).length == 0
        ) revert InvalidParameter();

        token = token_;
        TARGET_SPACING = targetSpacing_;
        HALVING_INTERVAL = halvingInterval_;
        INITIAL_TARGET = initialTarget_;
        // 16 x initial, saturating at 2^256 - 1.
        MAX_TARGET = initialTarget_ > type(uint256).max / MAX_TARGET_FACTOR
            ? type(uint256).max
            : initialTarget_ * MAX_TARGET_FACTOR;
        MIN_HOLD = minHold_;
        MIN_SPACING = minSpacing_;
        DEPLOYER = msg.sender;
        genesisMessage = genesisMessage_;

        bytes32 genesis = keccak256(abi.encode(block.chainid, keccak256(bytes(genesisMessage_))));
        GENESIS_CHALLENGE = genesis;
        _challenge = genesis;
        _target = initialTarget_;
    }

    // ------------------------------------------------------------------ start (one time)

    /// @notice Called once by the deployer after the reserve has been transferred in.
    ///         Fixes the reward schedule from the reserve. Afterwards the deployer has no powers at all.
    function start() external {
        if (msg.sender != DEPLOYER) revert NotDeployer();
        if (_started) revert AlreadyStarted();

        uint256 reserve = token.balanceOf(address(this));
        uint256 required = 2 * HALVING_INTERVAL;
        if (reserve < required) revert ReserveTooSmall(reserve, required);

        uint256 reward0 = reserve / required;
        initialReward = reward0;
        _started = true;
        _startTime = block.timestamp;
        _lastBlockTime = block.timestamp;

        emit Started(reward0, reserve, block.timestamp);
    }

    // ------------------------------------------------------------------ mining

    /// @notice Submit a proof of work. Pays the block reward to `beneficiary`.
    /// @param nonce        any uint256 such that keccak256(abi.encodePacked(challenge, beneficiary, nonce)) <= target
    /// @param beneficiary  receiver of the reward; bound into the digest (pool miners use the pool contract)
    function mint(uint256 nonce, address beneficiary) external nonReentrant returns (uint256 reward) {
        if (!_started) revert NotStarted();
        if (beneficiary == address(0)) revert ZeroBeneficiary();

        uint256 last = _lastBlockTime;
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < last + MIN_SPACING) revert TooEarly(last + MIN_SPACING);

        bytes32 challenge = _challenge;
        uint256 target = _target;
        bytes32 digest = keccak256(abi.encodePacked(challenge, beneficiary, nonce));
        if (uint256(digest) > target) revert HashAboveTarget(digest, target);

        uint256 balance = token.balanceOf(msg.sender);
        if (balance < MIN_HOLD) revert NotHolder(balance, MIN_HOLD);

        uint256 height = _height;
        reward = _rewardAt(height);
        if (reward == 0) revert EmissionComplete();

        // Effects.
        uint256 newTarget = nextTarget(target, block.timestamp - last);
        _target = newTarget;
        _challenge = keccak256(abi.encodePacked(challenge, digest, height));
        unchecked {
            height += 1;
        }
        _height = height;
        _lastBlockTime = block.timestamp;

        // Interaction.
        token.safeTransfer(beneficiary, reward);

        emit Mined(height, msg.sender, beneficiary, reward, digest, newTarget, block.timestamp);
    }

    // ------------------------------------------------------------------ views

    /// @notice Everything a miner needs in one call.
    /// @return challenge      current challenge to hash against
    /// @return target         a digest must be <= this
    /// @return height         blocks mined so far (the next block will be height + 1)
    /// @return reward         reward the next block pays (0 before start or after emission ends)
    /// @return lastBlockTime  timestamp of the last block (start time before block 1)
    /// @return reserve        tokens left in the vault
    /// @return minHold        token balance the submitter must hold
    /// @return minSpacing     minimum seconds between blocks
    /// @return startTime      timestamp of `start()` (0 before)
    /// @return started        whether mining is open
    function state()
        external
        view
        returns (
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
        )
    {
        challenge = _challenge;
        target = _target;
        height = _height;
        started = _started;
        reward = started ? _rewardAt(height) : 0;
        lastBlockTime = _lastBlockTime;
        reserve = token.balanceOf(address(this));
        minHold = MIN_HOLD;
        minSpacing = MIN_SPACING;
        startTime = _startTime;
    }

    /// @notice Damped per-block retarget. Pure function of the current target and the seconds since the last block.
    ///         target' = target * (3T + clamp(elapsed, T/4, 4T)) / (4T), capped at MAX_TARGET, floored at 1.
    ///         Each block can make mining at most 1.75x easier or 0.8125x as hard (13/16).
    function nextTarget(uint256 currentTarget, uint256 elapsed) public view returns (uint256) {
        uint256 t = TARGET_SPACING;
        uint256 lo = t / 4;
        uint256 hi = t * 4;
        uint256 dt = elapsed < lo ? lo : (elapsed > hi ? hi : elapsed);

        uint256 num = 3 * t + dt; // in [3.25T, 7T]
        uint256 den = 4 * t;
        uint256 maxTarget = MAX_TARGET;

        uint256 next;
        // If the product would land above the cap, the answer is the cap. This branch also guarantees that
        // mulDiv below never overflows 256 bits (result <= MAX_TARGET).
        if (num > den && currentTarget > Math.mulDiv(maxTarget, den, num)) {
            next = maxTarget;
        } else {
            next = Math.mulDiv(currentTarget, num, den);
        }
        if (next > maxTarget) next = maxTarget;
        if (next == 0) next = 1;
        return next;
    }

    /// @notice The digest a given (beneficiary, nonce) produces for the current challenge.
    function digestOf(address beneficiary, uint256 nonce) external view returns (bytes32) {
        return keccak256(abi.encodePacked(_challenge, beneficiary, nonce));
    }

    /// @notice First height of the next reward era.
    function nextHalvingAt() external view returns (uint256) {
        return (_height / HALVING_INTERVAL + 1) * HALVING_INTERVAL;
    }

    function _rewardAt(uint256 height) internal view returns (uint256 reward) {
        uint256 era = height / HALVING_INTERVAL;
        reward = era >= 256 ? 0 : initialReward >> era;
        uint256 balance = token.balanceOf(address(this));
        if (reward > balance) reward = balance;
    }
}
