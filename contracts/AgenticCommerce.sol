// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IACPHook.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

/**
 * @title AgenticCommerce (Simplified ERC-8183 Reference)
 * @notice Minimal implementation of ERC-8183: Agentic Commerce Protocol.
 *         Job-based escrow where a client funds a job, a provider submits work,
 *         and an evaluator attests completion or rejection.
 *
 * Lifecycle: Open → Funded → Submitted → Completed / Rejected / Expired
 *
 * Hooks: Optional IACPHook contract attached at job creation.
 *   - beforeAction/afterAction called on: setProvider, fund, submit, complete, reject
 *   - claimRefund is deliberately NOT hookable (safety: prevents fund locking)
 *
 * Note: This is a simplified reference for hackathon demonstration.
 *       Production implementations should use UUPS proxy pattern and AccessControl.
 */
contract AgenticCommerce {
    using SafeERC20 for IERC20;

    // ─── Enums ────────────────────────────────────────────────────────────
    enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

    // ─── Structs ──────────────────────────────────────────────────────────
    struct Job {
        address client;
        address provider;
        address evaluator;
        address hook;          // Optional IACPHook address (address(0) if none)
        address paymentToken;  // ERC-20 token (e.g., USDC)
        uint256 budget;
        uint256 expiry;        // Timestamp after which client can claim refund
        JobStatus status;
        string  serviceRef;    // Service identifier (e.g., "roulette_hbet")
        string  submissionRef; // Provider's deliverable reference
        string  reasonRef;     // Evaluator's completion/rejection reason
    }

    // ─── State ────────────────────────────────────────────────────────────
    uint256 public nextJobId;
    mapping(uint256 => Job) public jobs;

    // ─── Events ───────────────────────────────────────────────────────────
    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address evaluator,
        address hook,
        address paymentToken,
        string  serviceRef
    );
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event JobFunded(uint256 indexed jobId, uint256 amount);
    event WorkSubmitted(uint256 indexed jobId, string submissionRef);
    event JobCompleted(uint256 indexed jobId, string reasonRef);
    event JobRejected(uint256 indexed jobId, string reasonRef);
    event RefundClaimed(uint256 indexed jobId);

    // ─── Core Functions ───────────────────────────────────────────────────

    /**
     * @notice Create a new job.
     * @param evaluator  Address that can complete or reject
     * @param hook       Optional IACPHook (address(0) for no hook)
     * @param paymentToken  ERC-20 token for payment
     * @param expiry     Timestamp after which refund is claimable
     * @param serviceRef  Identifier for the service requested
     */
    function createJob(
        address evaluator,
        address hook,
        address paymentToken,
        uint256 expiry,
        string calldata serviceRef
    ) external returns (uint256 jobId) {
        require(evaluator != address(0), "ACP: evaluator required");
        require(expiry > block.timestamp, "ACP: expiry must be future");
        
        // Validate hook supports IACPHook if provided
        if (hook != address(0)) {
            require(
                ERC165Checker.supportsInterface(hook, type(IACPHook).interfaceId),
                "ACP: hook must implement IACPHook"
            );
        }

        jobId = nextJobId++;
        jobs[jobId] = Job({
            client: msg.sender,
            provider: address(0),
            evaluator: evaluator,
            hook: hook,
            paymentToken: paymentToken,
            budget: 0,
            expiry: expiry,
            status: JobStatus.Open,
            serviceRef: serviceRef,
            submissionRef: "",
            reasonRef: ""
        });

        emit JobCreated(jobId, msg.sender, evaluator, hook, paymentToken, serviceRef);
    }

    /**
     * @notice Set the provider for a job. Only client can call.
     */
    function setProvider(uint256 jobId, address provider) external {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client, "ACP: only client");
        require(job.status == JobStatus.Open || job.status == JobStatus.Funded, "ACP: invalid status");
        require(provider != address(0), "ACP: provider required");

        // Hook: beforeAction
        if (job.hook != address(0)) {
            IACPHook(job.hook).beforeAction(jobId, this.setProvider.selector, abi.encode(provider));
        }

        job.provider = provider;

        // Hook: afterAction
        if (job.hook != address(0)) {
            IACPHook(job.hook).afterAction(jobId, this.setProvider.selector, abi.encode(provider));
        }

        emit ProviderSet(jobId, provider);
    }

    /**
     * @notice Fund a job with ERC-20 tokens. Only client can call.
     */
    function fund(uint256 jobId, uint256 amount) external {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client, "ACP: only client");
        require(job.status == JobStatus.Open, "ACP: must be Open");
        require(amount > 0, "ACP: amount must be > 0");

        // Hook: beforeAction
        if (job.hook != address(0)) {
            IACPHook(job.hook).beforeAction(jobId, this.fund.selector, abi.encode(amount));
        }

        IERC20(job.paymentToken).safeTransferFrom(msg.sender, address(this), amount);
        job.budget = amount;
        job.status = JobStatus.Funded;

        // Hook: afterAction
        if (job.hook != address(0)) {
            IACPHook(job.hook).afterAction(jobId, this.fund.selector, abi.encode(amount));
        }

        emit JobFunded(jobId, amount);
    }

    /**
     * @notice Provider submits work. Only provider can call.
     */
    function submit(uint256 jobId, string calldata submissionRef) external {
        Job storage job = jobs[jobId];
        require(msg.sender == job.provider, "ACP: only provider");
        require(job.status == JobStatus.Funded, "ACP: must be Funded");

        // Hook: beforeAction
        if (job.hook != address(0)) {
            IACPHook(job.hook).beforeAction(jobId, this.submit.selector, abi.encode(submissionRef));
        }

        job.submissionRef = submissionRef;
        job.status = JobStatus.Submitted;

        // Hook: afterAction
        if (job.hook != address(0)) {
            IACPHook(job.hook).afterAction(jobId, this.submit.selector, abi.encode(submissionRef));
        }

        emit WorkSubmitted(jobId, submissionRef);
    }

    /**
     * @notice Evaluator marks job as complete. Releases funds to provider.
     */
    function complete(uint256 jobId, string calldata reasonRef) external {
        Job storage job = jobs[jobId];
        require(msg.sender == job.evaluator, "ACP: only evaluator");
        require(job.status == JobStatus.Submitted, "ACP: must be Submitted");

        // Hook: beforeAction — THIS IS WHERE SIEVE ENFORCES DAS CHECK
        if (job.hook != address(0)) {
            IACPHook(job.hook).beforeAction(jobId, this.complete.selector, abi.encode(reasonRef));
        }

        job.reasonRef = reasonRef;
        job.status = JobStatus.Completed;

        // Release funds to provider
        IERC20(job.paymentToken).safeTransfer(job.provider, job.budget);

        // Hook: afterAction — Sieve emits attestation
        if (job.hook != address(0)) {
            IACPHook(job.hook).afterAction(jobId, this.complete.selector, abi.encode(reasonRef));
        }

        emit JobCompleted(jobId, reasonRef);
    }

    /**
     * @notice Evaluator rejects the submission. Funds return to client.
     */
    function reject(uint256 jobId, string calldata reasonRef) external {
        Job storage job = jobs[jobId];
        require(msg.sender == job.evaluator, "ACP: only evaluator");
        require(job.status == JobStatus.Submitted, "ACP: must be Submitted");

        // Hook: beforeAction
        if (job.hook != address(0)) {
            IACPHook(job.hook).beforeAction(jobId, this.reject.selector, abi.encode(reasonRef));
        }

        job.reasonRef = reasonRef;
        job.status = JobStatus.Rejected;

        // Return funds to client
        IERC20(job.paymentToken).safeTransfer(job.client, job.budget);

        // Hook: afterAction
        if (job.hook != address(0)) {
            IACPHook(job.hook).afterAction(jobId, this.reject.selector, abi.encode(reasonRef));
        }

        emit JobRejected(jobId, reasonRef);
    }

    /**
     * @notice Client claims refund after expiry. NOT HOOKABLE (safety mechanism).
     */
    function claimRefund(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(msg.sender == job.client, "ACP: only client");
        require(
            job.status == JobStatus.Funded || job.status == JobStatus.Submitted,
            "ACP: must be Funded or Submitted"
        );
        require(block.timestamp > job.expiry, "ACP: not expired");

        job.status = JobStatus.Expired;
        IERC20(job.paymentToken).safeTransfer(job.client, job.budget);

        // NO HOOKS — by design. Prevents malicious hooks from locking funds.
        emit RefundClaimed(jobId);
    }

    // ─── View Functions ───────────────────────────────────────────────────

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    function getJobStatus(uint256 jobId) external view returns (JobStatus) {
        return jobs[jobId].status;
    }
}
