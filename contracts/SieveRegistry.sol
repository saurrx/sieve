// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SieveRegistry
 * @notice On-chain Demand Authenticity Score (DAS) registry for AI agents.
 *
 * Architecture:
 *   - Scoring engine (off-chain) indexes ACP V1/V2 events from Base mainnet
 *   - Computes 5 signals: funder concentration, buyer independence, timing distribution,
 *     circular flow detection, proof-of-human attestation
 *   - Writes composite DAS (0-100) + verified revenue to this registry
 *   - SieveHook (ERC-8183) reads this registry at settlement time
 *   - Anyone can read scores — no API key, fully composable
 *
 * Data sources:
 *   - Virtuals ACP V1: 0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A (Base)
 *   - Virtuals ACP V2: 0xa6C9BA866992cfD7fd6460ba912bfa405adA9df0 (Base)
 *   - ERC-8004 IdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e (Base)
 *
 * ERC-8004 integration:
 *   - Reads agent identity from IdentityRegistry
 *   - Scores can be cross-referenced with ERC-8004 reputation via agentId mapping
 *   - Designed to plug into ERC-8004 ValidationRegistry as a demand-authenticity validator
 */
contract SieveRegistry {

    // ─── Types ────────────────────────────────────────────────────────────
    struct Score {
        uint8   das;              // Demand Authenticity Score (0-100)
        uint256 verifiedRevenue;  // Revenue from independent buyers (in USDC, 6 decimals)
        uint256 rawRevenue;       // Total reported revenue (in USDC, 6 decimals)
        uint256 uniqueBuyers;     // Count of independent (non-sybil) buyers
        uint256 totalBuyers;      // Total buyer addresses observed
        uint40  lastUpdated;      // Timestamp of last score update
        uint8   funderConcentration;   // Signal 1: 0-100 (100 = all buyers share funder)
        uint8   buyerIndependence;     // Signal 2: 0-100 (100 = all buyers multi-provider)
        uint8   timingRegularity;      // Signal 3: 0-100 (100 = perfectly regular = bot-like)
        uint8   circularFlowRate;      // Signal 4: 0-100 (100 = all revenue is circular)
        uint8   humanAttestationRate;  // Signal 5: 0-100 (100 = all buyers have World ID)
    }

    struct AgentMapping {
        uint256 erc8004AgentId;   // ERC-8004 agentId on IdentityRegistry (0 if not registered)
        uint256 virtualsAgentId;  // Virtuals Protocol agent ID (e.g., 42524 for Hyperbet)
    }

    // ─── Events ───────────────────────────────────────────────────────────
    event ScoreUpdated(
        address indexed agent,
        uint8   das,
        uint256 verifiedRevenue,
        uint256 rawRevenue,
        uint256 uniqueBuyers,
        uint256 totalBuyers,
        uint40  timestamp
    );

    event AgentMapped(
        address indexed agent,
        uint256 erc8004AgentId,
        uint256 virtualsAgentId
    );

    event ScorerUpdated(address indexed oldScorer, address indexed newScorer);
    event ThresholdUpdated(uint8 oldThreshold, uint8 newThreshold);

    // ─── State ────────────────────────────────────────────────────────────
    address public owner;
    address public scorer;           // Authorized scoring engine address
    uint8   public defaultThreshold; // Default minimum DAS for hook enforcement

    mapping(address => Score)        public scores;
    mapping(address => AgentMapping) public agentMappings;

    address[] public scoredAgents;   // Array of all scored agent addresses

    // ─── Modifiers ────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "SieveRegistry: not owner");
        _;
    }

    modifier onlyScorer() {
        require(msg.sender == scorer || msg.sender == owner, "SieveRegistry: not scorer");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────
    constructor(address _scorer) {
        owner = msg.sender;
        scorer = _scorer;
        defaultThreshold = 50; // Default: block agents scoring below 50/100
    }

    // ─── Write Functions (scorer only) ────────────────────────────────────

    /**
     * @notice Update the DAS for an agent. Called by the off-chain scoring engine.
     */
    function updateScore(
        address agent,
        uint8   das,
        uint256 verifiedRevenue,
        uint256 rawRevenue,
        uint256 uniqueBuyers,
        uint256 totalBuyers,
        uint8   funderConcentration,
        uint8   buyerIndependence,
        uint8   timingRegularity,
        uint8   circularFlowRate,
        uint8   humanAttestationRate
    ) external onlyScorer {
        require(das <= 100, "SieveRegistry: DAS must be 0-100");
        require(funderConcentration <= 100, "SieveRegistry: signal must be 0-100");
        require(buyerIndependence <= 100, "SieveRegistry: signal must be 0-100");
        require(timingRegularity <= 100, "SieveRegistry: signal must be 0-100");
        require(circularFlowRate <= 100, "SieveRegistry: signal must be 0-100");
        require(humanAttestationRate <= 100, "SieveRegistry: signal must be 0-100");

        // Track new agents
        if (scores[agent].lastUpdated == 0) {
            scoredAgents.push(agent);
        }

        scores[agent] = Score({
            das: das,
            verifiedRevenue: verifiedRevenue,
            rawRevenue: rawRevenue,
            uniqueBuyers: uniqueBuyers,
            totalBuyers: totalBuyers,
            lastUpdated: uint40(block.timestamp),
            funderConcentration: funderConcentration,
            buyerIndependence: buyerIndependence,
            timingRegularity: timingRegularity,
            circularFlowRate: circularFlowRate,
            humanAttestationRate: humanAttestationRate
        });

        emit ScoreUpdated(agent, das, verifiedRevenue, rawRevenue, uniqueBuyers, totalBuyers, uint40(block.timestamp));
    }

    /**
     * @notice Map an agent wallet to ERC-8004 and Virtuals IDs.
     */
    function mapAgent(
        address agent,
        uint256 erc8004AgentId,
        uint256 virtualsAgentId
    ) external onlyScorer {
        agentMappings[agent] = AgentMapping({
            erc8004AgentId: erc8004AgentId,
            virtualsAgentId: virtualsAgentId
        });
        emit AgentMapped(agent, erc8004AgentId, virtualsAgentId);
    }

    /**
     * @notice Batch update scores for multiple agents.
     */
    function batchUpdateScores(
        address[] calldata agents,
        uint8[]   calldata dasScores,
        uint256[] calldata verifiedRevenues,
        uint256[] calldata rawRevenues,
        uint256[] calldata uniqueBuyerCounts,
        uint256[] calldata totalBuyerCounts
    ) external onlyScorer {
        require(agents.length == dasScores.length, "SieveRegistry: length mismatch");
        for (uint256 i = 0; i < agents.length; i++) {
            if (scores[agents[i]].lastUpdated == 0) {
                scoredAgents.push(agents[i]);
            }
            scores[agents[i]].das = dasScores[i];
            scores[agents[i]].verifiedRevenue = verifiedRevenues[i];
            scores[agents[i]].rawRevenue = rawRevenues[i];
            scores[agents[i]].uniqueBuyers = uniqueBuyerCounts[i];
            scores[agents[i]].totalBuyers = totalBuyerCounts[i];
            scores[agents[i]].lastUpdated = uint40(block.timestamp);
            emit ScoreUpdated(agents[i], dasScores[i], verifiedRevenues[i], rawRevenues[i], uniqueBuyerCounts[i], totalBuyerCounts[i], uint40(block.timestamp));
        }
    }

    // ─── Read Functions (public) ──────────────────────────────────────────

    /**
     * @notice Get the DAS for an agent. Returns 0 if not scored.
     */
    function getDAS(address agent) external view returns (uint8) {
        return scores[agent].das;
    }

    /**
     * @notice Get the full score breakdown for an agent.
     */
    function getScore(address agent) external view returns (Score memory) {
        return scores[agent];
    }

    /**
     * @notice Check if an agent passes the threshold.
     */
    function passesThreshold(address agent, uint8 threshold) external view returns (bool) {
        return scores[agent].das >= threshold;
    }

    /**
     * @notice Check if an agent passes the default threshold.
     */
    function passesDefaultThreshold(address agent) external view returns (bool) {
        return scores[agent].das >= defaultThreshold;
    }

    /**
     * @notice Get count of scored agents.
     */
    function getScoredAgentCount() external view returns (uint256) {
        return scoredAgents.length;
    }

    /**
     * @notice Get agent address by index.
     */
    function getScoredAgent(uint256 index) external view returns (address) {
        require(index < scoredAgents.length, "SieveRegistry: index out of bounds");
        return scoredAgents[index];
    }

    // ─── Admin Functions ──────────────────────────────────────────────────

    function setScorer(address _scorer) external onlyOwner {
        emit ScorerUpdated(scorer, _scorer);
        scorer = _scorer;
    }

    function setDefaultThreshold(uint8 _threshold) external onlyOwner {
        require(_threshold <= 100, "SieveRegistry: threshold must be 0-100");
        emit ThresholdUpdated(defaultThreshold, _threshold);
        defaultThreshold = _threshold;
    }

    function transferOwnership(address _owner) external onlyOwner {
        owner = _owner;
    }
}
