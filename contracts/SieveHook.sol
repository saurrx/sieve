// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IACPHook.sol";
import "./SieveRegistry.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/**
 * @title SieveHook
 * @notice ERC-8183 hook that enforces demand authenticity at the protocol level.
 *
 * How it works:
 *   1. When a job is created with this hook attached, all hookable actions
 *      pass through beforeAction/afterAction
 *   2. On `complete` (selector 0x...), beforeAction checks the PROVIDER's
 *      Demand Authenticity Score from SieveRegistry
 *   3. If the provider's DAS is below the threshold, the transaction reverts
 *      → settlement is blocked → farming revenue cannot be extracted
 *   4. On `complete` afterAction, emits a DemandAuthenticated attestation
 *
 * Hookable selectors (from ERC-8183):
 *   - setProvider:  0x... (not enforced by Sieve)
 *   - setBudget:    0x... (not enforced by Sieve)
 *   - fund:         0x... (not enforced by Sieve)
 *   - submit:       0x... (not enforced by Sieve)
 *   - complete:     0x... (ENFORCED — blocks low-DAS providers)
 *   - reject:       0x... (not enforced by Sieve)
 *
 * ERC-8004 integration:
 *   - SieveRegistry stores cross-reference to ERC-8004 agentId
 *   - Future: afterAction could write feedback to ERC-8004 ReputationRegistry
 *
 * ERC-8183 spec compliance:
 *   - claimRefund is deliberately NOT hookable (safety mechanism)
 *   - beforeAction MAY revert to block the action
 *   - afterAction is for side-effects only (should not revert under normal conditions)
 */
contract SieveHook is IACPHook, ERC165 {

    // ─── Events ───────────────────────────────────────────────────────────
    event DemandAuthenticated(
        uint256 indexed jobId,
        address indexed provider,
        uint8   das,
        uint256 verifiedRevenue,
        bool    passed
    );

    event SettlementBlocked(
        uint256 indexed jobId,
        address indexed provider,
        uint8   das,
        uint8   threshold,
        string  reason
    );

    // ─── State ────────────────────────────────────────────────────────────
    SieveRegistry public immutable registry;
    address public owner;
    uint8 public threshold;  // Minimum DAS to pass settlement
    bool public enforcementEnabled;

    // Mapping from jobId to provider address (populated by ACP contract or setProvider hook)
    mapping(uint256 => address) public jobProviders;
    
    // Stats
    uint256 public totalChecks;
    uint256 public totalBlocked;
    uint256 public totalPassed;

    // Known selectors for ERC-8183 actions
    // These would be the actual function selectors from AgenticCommerce.sol
    bytes4 public constant COMPLETE_SELECTOR = bytes4(keccak256("complete(uint256,string)"));
    bytes4 public constant SET_PROVIDER_SELECTOR = bytes4(keccak256("setProvider(uint256,address)"));
    bytes4 public constant FUND_SELECTOR = bytes4(keccak256("fund(uint256,uint256)"));
    bytes4 public constant SUBMIT_SELECTOR = bytes4(keccak256("submit(uint256,string)"));
    bytes4 public constant REJECT_SELECTOR = bytes4(keccak256("reject(uint256,string)"));

    // ─── Constructor ──────────────────────────────────────────────────────
    constructor(address _registry, uint8 _threshold) {
        registry = SieveRegistry(_registry);
        owner = msg.sender;
        threshold = _threshold;
        enforcementEnabled = true;
    }

    // ─── IACPHook Implementation ──────────────────────────────────────────

    /**
     * @notice Called before a hookable action. Reverts on `complete` if provider
     *         DAS is below threshold.
     */
    function beforeAction(
        uint256 jobId,
        bytes4 selector,
        bytes calldata data
    ) external override {
        // Track provider from setProvider calls
        if (selector == SET_PROVIDER_SELECTOR) {
            // data = abi.encode(provider address)
            if (data.length >= 32) {
                address provider = abi.decode(data, (address));
                jobProviders[jobId] = provider;
            }
            return;
        }

        // Enforce DAS check on complete
        if (selector == COMPLETE_SELECTOR) {
            address provider = jobProviders[jobId];
            totalChecks++;

            if (provider == address(0)) {
                // No provider tracked — allow but log
                emit DemandAuthenticated(jobId, address(0), 0, 0, true);
                totalPassed++;
                return;
            }

            SieveRegistry.Score memory score = registry.getScore(provider);
            uint8 das = score.das;

            if (enforcementEnabled && das < threshold && score.lastUpdated > 0) {
                // BLOCK SETTLEMENT
                totalBlocked++;
                emit SettlementBlocked(
                    jobId,
                    provider,
                    das,
                    threshold,
                    "Demand authenticity score below threshold"
                );
                revert(
                    string(abi.encodePacked(
                        "SieveHook: provider DAS ",
                        _uint8ToString(das),
                        "/100 below threshold ",
                        _uint8ToString(threshold),
                        "/100. Suspected demand farming detected."
                    ))
                );
            }

            totalPassed++;
            emit DemandAuthenticated(jobId, provider, das, score.verifiedRevenue, true);
        }
    }

    /**
     * @notice Called after a hookable action completes. Emits attestation on complete.
     *         Does not revert under normal conditions.
     */
    function afterAction(
        uint256 jobId,
        bytes4 selector,
        bytes calldata data
    ) external override {
        // After complete: emit attestation event
        if (selector == COMPLETE_SELECTOR) {
            address provider = jobProviders[jobId];
            if (provider != address(0)) {
                SieveRegistry.Score memory score = registry.getScore(provider);
                emit DemandAuthenticated(jobId, provider, score.das, score.verifiedRevenue, true);
            }
        }
    }

    // ─── ERC-165 ──────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IACPHook).interfaceId || super.supportsInterface(interfaceId);
    }

    // ─── Admin ────────────────────────────────────────────────────────────

    function setThreshold(uint8 _threshold) external {
        require(msg.sender == owner, "SieveHook: not owner");
        require(_threshold <= 100, "SieveHook: threshold must be 0-100");
        threshold = _threshold;
    }

    function setEnforcement(bool _enabled) external {
        require(msg.sender == owner, "SieveHook: not owner");
        enforcementEnabled = _enabled;
    }

    /**
     * @notice Manually register a provider for a job (for demo/testing).
     */
    function registerJobProvider(uint256 jobId, address provider) external {
        require(msg.sender == owner, "SieveHook: not owner");
        jobProviders[jobId] = provider;
    }

    // ─── View Functions ───────────────────────────────────────────────────

    function getStats() external view returns (uint256 checks, uint256 blocked, uint256 passed) {
        return (totalChecks, totalBlocked, totalPassed);
    }

    function wouldBlock(address provider) external view returns (bool) {
        SieveRegistry.Score memory score = registry.getScore(provider);
        return enforcementEnabled && score.das < threshold && score.lastUpdated > 0;
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────

    function _uint8ToString(uint8 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint8 temp = v;
        uint8 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (v != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint8(v % 10)));
            v /= 10;
        }
        return string(buffer);
    }
}
