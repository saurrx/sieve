// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title IACPHook - ERC-8183 Hook Interface
 * @notice Generic hook interface for the Agentic Commerce Protocol.
 *         Uses two functions (beforeAction/afterAction) with a selector parameter
 *         rather than named functions per action.
 */
interface IACPHook is IERC165 {
    /**
     * @notice Called before a hookable action executes.
     *         MAY revert to block the action.
     * @param jobId  The job this action belongs to
     * @param selector  The function selector of the action being performed
     * @param data  ABI-encoded arguments specific to the action
     */
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;

    /**
     * @notice Called after a hookable action completes successfully.
     *         Used for side-effects (e.g., reputation updates, attestations).
     * @param jobId  The job this action belongs to
     * @param selector  The function selector of the action that was performed
     * @param data  ABI-encoded arguments specific to the action
     */
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
