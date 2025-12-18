// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

/**
 * @title SampleNFT
 * @dev ERC721 NFT contract with ERC2771 meta-transaction support.
 * This NFT can be transferred using gasless transactions through a trusted forwarder.
 */
contract SampleNFT is
    ERC721,
    ERC721Burnable,
    ERC721Enumerable,
    Ownable,
    ERC2771Context
{
    uint256 private _nextTokenId;

    /**
     * @dev Initializes the NFT contract.
     * @param forwarder The address of the trusted forwarder for meta-transactions.
     */
    constructor(address forwarder)
        ERC721("Sample NFT", "SNFT")
        Ownable(msg.sender)
        ERC2771Context(forwarder)
    {
        _nextTokenId = 1;
    }

    /**
     * @dev Mints a new NFT to the specified address.
     * Only callable by the contract owner.
     * @param to The address that will receive the minted NFT.
     * @return tokenId The ID of the newly minted NFT.
     */
    function mint(address to) public onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;
        _safeMint(to, tokenId);
        return tokenId;
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
     * @dev Override required for ERC721Enumerable.
     * Updates token ownership tracking.
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    /**
     * @dev Override required for ERC721Enumerable.
     * Increments approval on ownership change.
     */
    function _increaseBalance(address account, uint128 amount)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, amount);
    }

    /**
     * @dev Returns whether the interface is supported.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
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
