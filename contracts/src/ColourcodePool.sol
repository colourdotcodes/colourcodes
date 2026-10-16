// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title ColourcodePool
/// @notice The Colourcode Pool's payout vault. Block rewards found by pool miners are minted to this contract
///         (it is the `beneficiary`). Once per epoch the operator (the pool server wallet, fixed at deployment)
///         posts a merkle root of who earned what. Miners claim with a proof.
///
///         - An epoch's `total` must fit in the unallocated balance (balance minus everything already allocated
///           and not yet claimed), so roots can never promise more than the pool holds.
///         - Epochs can be posted once and never overwritten.
///         - Each (epoch, account) can claim once; claims of an epoch can never exceed its posted total.
///         - There is no other way for tokens to leave: no owner withdraw, no sweep, no setters.
///
///         Leaf format (OpenZeppelin StandardMerkleTree, sorted pairs):
///             leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
contract ColourcodePool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The mined token.
    IERC20 public immutable token;
    /// @notice Pool server wallet allowed to post epochs. Set once at deployment.
    address public immutable operator;

    /// @notice Merkle root of each posted epoch (zero = not posted).
    mapping(uint256 epoch => bytes32) public epochRoot;
    /// @notice Total allocated in each epoch.
    mapping(uint256 epoch => uint256) public epochTotal;
    /// @notice Amount already claimed from each epoch.
    mapping(uint256 epoch => uint256) public epochClaimed;
    /// @notice Tokens allocated by posted epochs and not yet claimed.
    uint256 public outstanding;
    /// @notice Number of epochs posted so far.
    uint256 public epochCount;

    mapping(uint256 epoch => mapping(address account => bool)) private _claimed;

    event EpochPosted(uint256 indexed epoch, bytes32 root, uint256 total);
    event Claimed(uint256 indexed epoch, address indexed account, uint256 amount);

    error InvalidParameter();
    error NotOperator();
    error EpochExists(uint256 epoch);
    error EpochUnknown(uint256 epoch);
    error OverAllocation(uint256 total, uint256 unallocated);
    error AlreadyClaimed(uint256 epoch, address account);
    error InvalidProof();
    error EpochExhausted(uint256 epoch);

    constructor(IERC20 token_, address operator_) {
        if (address(token_) == address(0) || operator_ == address(0)) revert InvalidParameter();
        token = token_;
        operator = operator_;
    }

    /// @notice Post the payout root of an epoch. Operator only. `total` must be <= unallocated().
    function postEpoch(uint256 epoch, bytes32 root, uint256 total) external {
        if (msg.sender != operator) revert NotOperator();
        if (root == bytes32(0) || total == 0) revert InvalidParameter();
        if (epochRoot[epoch] != bytes32(0)) revert EpochExists(epoch);

        uint256 free = unallocated();
        if (total > free) revert OverAllocation(total, free);

        epochRoot[epoch] = root;
        epochTotal[epoch] = total;
        outstanding += total;
        epochCount += 1;

        emit EpochPosted(epoch, root, total);
    }

    /// @notice Claim `amount` for `account` from `epoch`. Anyone may submit; tokens always go to `account`.
    function claim(uint256 epoch, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        bytes32 root = epochRoot[epoch];
        if (root == bytes32(0)) revert EpochUnknown(epoch);
        if (_claimed[epoch][account]) revert AlreadyClaimed(epoch, account);

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verifyCalldata(proof, root, leaf)) revert InvalidProof();

        uint256 claimedSoFar = epochClaimed[epoch] + amount;
        if (claimedSoFar > epochTotal[epoch]) revert EpochExhausted(epoch);

        _claimed[epoch][account] = true;
        epochClaimed[epoch] = claimedSoFar;
        outstanding -= amount;

        token.safeTransfer(account, amount);

        emit Claimed(epoch, account, amount);
    }

    /// @notice Whether `account` already claimed from `epoch`.
    function claimed(uint256 epoch, address account) external view returns (bool) {
        return _claimed[epoch][account];
    }

    /// @notice Tokens held by the pool that no posted epoch has allocated yet.
    function unallocated() public view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        return balance > outstanding ? balance - outstanding : 0;
    }
}
