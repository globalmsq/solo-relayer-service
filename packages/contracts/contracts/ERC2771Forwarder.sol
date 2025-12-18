// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC2771Forwarder as OZForwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/**
 * @title ERC2771Forwarder
 * @notice Trusted forwarder for meta-transactions (gasless transactions)
 * @dev Extends OpenZeppelin's ERC2771Forwarder
 *
 * This contract is used to forward meta-transactions from users who don't have
 * native tokens (ETH) to pay for gas. The relayer pays the gas on behalf of users.
 *
 * Deployment Order:
 * 1. Deploy this ERC2771Forwarder
 * 2. Deploy SampleToken(forwarderAddress)
 * 3. Deploy SampleNFT(forwarderAddress)
 */
contract ERC2771Forwarder is OZForwarder {
    constructor(string memory name) OZForwarder(name) {}
}
