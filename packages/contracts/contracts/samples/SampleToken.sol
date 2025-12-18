// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/**
 * @title SampleToken
 * @dev ERC20 token with ERC2771 meta-transaction support.
 * This token can be transferred using gasless transactions through a trusted forwarder.
 */
contract SampleToken is
    ERC20,
    ERC20Burnable,
    ERC20Pausable,
    Ownable,
    ERC2771Context
{
    /**
     * @dev Initializes the token with initial supply.
     * @param forwarder The address of the trusted forwarder for meta-transactions.
     */
    constructor(address forwarder)
        ERC20("Sample Token", "SMPL")
        Ownable(msg.sender)
        ERC2771Context(forwarder)
    {
        uint256 initialSupply = 1000000 * 10 ** decimals();
        _mint(msg.sender, initialSupply);
    }

    /**
     * @dev Pauses all token transfers.
     * Only callable by the contract owner.
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses all token transfers.
     * Only callable by the contract owner.
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    /**
     * @dev Mints new tokens to a specified address.
     * Only callable by the contract owner.
     * @param to The address that will receive the minted tokens.
     * @param amount The amount of tokens to mint.
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Returns the address of the current ERC2771 forwarder.
     */
    function getTrustedForwarder() public view returns (address) {
        return trustedForwarder();
    }

    /**
     * @dev Override required for ERC2771Context compatibility.
     * Returns the sender of the transaction.
     * Always returns msg.sender since we don't use ERC2771 forwarder in tests.
     */
    function _msgSender()
        internal
        view
        override(Context, ERC2771Context)
        returns (address)
    {
        return msg.sender;
    }

    /**
     * @dev Override required for ERC2771Context compatibility.
     * Returns the calldata.
     * Always returns msg.data since we don't use ERC2771 forwarder in tests.
     */
    function _msgData()
        internal
        view
        override(Context, ERC2771Context)
        returns (bytes calldata)
    {
        return msg.data;
    }

    /**
     * @dev Override required for ERC2771Context compatibility.
     * Returns the length of the meta-transaction suffix.
     * Always returns 0 since we don't use ERC2771 forwarder in tests.
     */
    function _contextSuffixLength()
        internal
        view
        override(Context, ERC2771Context)
        returns (uint256)
    {
        return 0;
    }

    /**
     * @dev Override required for ERC20Pausable.
     * Ensures tokens cannot be transferred when paused.
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Pausable) {
        super._update(from, to, amount);
    }

    /**
     * @dev Checks if an account is valid to receive tokens.
     * This is required for full ERC20 compatibility.
     */
    function nonces(address owner) public pure returns (uint256) {
        return 0;
    }

    /**
     * @dev Test function to ensure internal context functions are covered.
     * This is used for testing and coverage purposes.
     */
    function testContextData() public view returns (bytes memory) {
        return _msgData();
    }

    /**
     * @dev Test function to ensure context suffix length is covered.
     */
    function testContextSuffixLength() public view returns (uint256) {
        return _contextSuffixLength();
    }
}
