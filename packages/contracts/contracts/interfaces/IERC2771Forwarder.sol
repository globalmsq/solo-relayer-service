// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/**
 * @title IERC2771Forwarder
 * @dev Interface for ERC2771 meta-transaction forwarder.
 * Enables gasless transactions through a trusted forwarder.
 */
interface IERC2771Forwarder {
    /**
     * @dev Emitted when a forward request is executed.
     */
    event ExecutedForwardRequest(
        address indexed from,
        address indexed to,
        bytes data
    );

    /**
     * @dev Executes a forward request on behalf of a user.
     * @param from The address of the original transaction sender.
     * @param to The target contract address.
     * @param data The transaction data.
     * @return success Whether the call was successful.
     * @return result The return data from the called function.
     */
    function forward(
        address from,
        address to,
        bytes calldata data
    ) external returns (bool success, bytes memory result);

    /**
     * @dev Checks if an address is a trusted forwarder.
     * @param forwarder The address to check.
     * @return Whether the address is a trusted forwarder.
     */
    function isTrustedForwarder(address forwarder) external view returns (bool);
}
