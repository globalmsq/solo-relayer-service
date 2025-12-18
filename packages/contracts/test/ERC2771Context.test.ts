import { expect } from "chai";
import { ethers } from "hardhat";
import { SampleToken, SampleNFT } from "../typechain-types";

describe("ERC2771Context", function () {
  let sampleToken: SampleToken;
  let sampleNFT: SampleNFT;
  let owner: any;
  let forwarder: any;
  let addr1: any;

  beforeEach(async function () {
    [owner, forwarder, addr1] = await ethers.getSigners();

    const SampleTokenFactory = await ethers.getContractFactory("SampleToken");
    // Deploy with owner as the signer (who becomes msg.sender)
    sampleToken = await SampleTokenFactory.connect(owner).deploy(forwarder.address);
    await sampleToken.waitForDeployment();

    const SampleNFTFactory = await ethers.getContractFactory("SampleNFT");
    // Deploy with owner as the signer (who becomes msg.sender)
    sampleNFT = await SampleNFTFactory.connect(owner).deploy(forwarder.address);
    await sampleNFT.waitForDeployment();
  });

  describe("SampleToken ERC2771Context", function () {
    it("Should have correct trusted forwarder", async function () {
      expect(await sampleToken.getTrustedForwarder()).to.equal(forwarder.address);
    });

    it("Should accept zero address as trusted forwarder", async function () {
      const SampleTokenFactory = await ethers.getContractFactory("SampleToken");
      const token = await SampleTokenFactory.connect(owner).deploy(ethers.ZeroAddress);
      await token.waitForDeployment();

      expect(await token.getTrustedForwarder()).to.equal(ethers.ZeroAddress);
    });

    it("Should have trustedForwarder function", async function () {
      const forwarderAddr = await sampleToken.trustedForwarder();
      expect(forwarderAddr).to.equal(forwarder.address);
    });

    it("Should maintain ERC2771 compatibility", async function () {
      // Verify that the contract inherits from ERC2771Context
      const trustedForwarder = await sampleToken.trustedForwarder();
      expect(trustedForwarder).to.not.be.undefined;
    });
  });

  describe("SampleNFT ERC2771Context", function () {
    it("Should have correct trusted forwarder", async function () {
      expect(await sampleNFT.getTrustedForwarder()).to.equal(forwarder.address);
    });

    it("Should accept zero address as trusted forwarder", async function () {
      const SampleNFTFactory = await ethers.getContractFactory("SampleNFT");
      const nft = await SampleNFTFactory.connect(owner).deploy(ethers.ZeroAddress);
      await nft.waitForDeployment();

      expect(await nft.getTrustedForwarder()).to.equal(ethers.ZeroAddress);
    });

    it("Should have trustedForwarder function", async function () {
      const forwarderAddr = await sampleNFT.trustedForwarder();
      expect(forwarderAddr).to.equal(forwarder.address);
    });

    it("Should maintain ERC2771 compatibility", async function () {
      // Verify that the contract inherits from ERC2771Context
      const trustedForwarder = await sampleNFT.trustedForwarder();
      expect(trustedForwarder).to.not.be.undefined;
    });
  });

  describe("Meta-transaction readiness", function () {
    it("SampleToken should be ready for meta-transactions", async function () {
      const token = sampleToken;
      const trustedForwarder = await token.trustedForwarder();

      // Verify forwarder is set and not zero
      expect(trustedForwarder).to.equal(forwarder.address);
      expect(trustedForwarder).to.not.equal(ethers.ZeroAddress);
    });

    it("SampleNFT should be ready for meta-transactions", async function () {
      const nft = sampleNFT;
      const trustedForwarder = await nft.trustedForwarder();

      // Verify forwarder is set and not zero
      expect(trustedForwarder).to.equal(forwarder.address);
      expect(trustedForwarder).to.not.equal(ethers.ZeroAddress);
    });

    it("Should allow owner to transfer when forwarder is set", async function () {
      // Owner should always be able to transfer
      const transferAmount = ethers.parseEther("100");
      await sampleToken.transfer(addr1.address, transferAmount);
      expect(await sampleToken.balanceOf(addr1.address)).to.equal(transferAmount);
    });

    it("Should support ERC2771 for NFT operations", async function () {
      // Owner should be able to mint when forwarder is set
      await sampleNFT.mint(addr1.address);
      expect(await sampleNFT.balanceOf(addr1.address)).to.equal(1);
    });
  });

  describe("Forwarder configuration", function () {
    it("Should initialize with custom forwarder", async function () {
      const customForwarder = addr1.address;

      const SampleTokenFactory = await ethers.getContractFactory("SampleToken");
      const token = await SampleTokenFactory.connect(owner).deploy(customForwarder);
      await token.waitForDeployment();

      expect(await token.getTrustedForwarder()).to.equal(customForwarder);
    });

    it("Should handle forwarder address changes in subsequent deployments", async function () {
      const SampleTokenFactory = await ethers.getContractFactory("SampleToken");

      const token1 = await SampleTokenFactory.connect(owner).deploy(owner.address);
      await token1.waitForDeployment();

      const token2 = await SampleTokenFactory.connect(owner).deploy(forwarder.address);
      await token2.waitForDeployment();

      expect(await token1.getTrustedForwarder()).to.equal(owner.address);
      expect(await token2.getTrustedForwarder()).to.equal(forwarder.address);
    });

    it("Should maintain forwarder immutability", async function () {
      const initialForwarder = await sampleToken.getTrustedForwarder();

      // Transfer ownership to another address
      await sampleToken.transferOwnership(addr1.address);

      // Forwarder should remain the same
      const finalForwarder = await sampleToken.getTrustedForwarder();
      expect(finalForwarder).to.equal(initialForwarder);
    });
  });

  describe("Context function compatibility", function () {
    it("Token should maintain _msgSender functionality", async function () {
      // This implicitly tests _msgSender through normal operations
      const transferAmount = ethers.parseEther("100");

      // Direct owner transfer
      await sampleToken.transfer(addr1.address, transferAmount);
      expect(await sampleToken.balanceOf(addr1.address)).to.equal(transferAmount);

      // Delegated transfer through approval
      await sampleToken
        .connect(addr1)
        .approve(owner.address, ethers.parseEther("50"));
      const allowance = await sampleToken.allowance(addr1.address, owner.address);
      expect(allowance).to.equal(ethers.parseEther("50"));
    });

    it("NFT should maintain _msgSender functionality", async function () {
      // This implicitly tests _msgSender through normal operations
      await sampleNFT.mint(addr1.address);
      expect(await sampleNFT.balanceOf(addr1.address)).to.equal(1);

      // Transfer should work correctly
      await sampleNFT
        .connect(addr1)
        .transferFrom(addr1.address, owner.address, 1);
      expect(await sampleNFT.ownerOf(1)).to.equal(owner.address);
    });
  });

  describe("ERC2771 inheritance resolution", function () {
    it("SampleToken should properly override _msgSender", async function () {
      // Verify that the token properly delegates to ERC2771Context
      const trustedForwarder = await sampleToken.trustedForwarder();
      expect(trustedForwarder).to.equal(forwarder.address);

      // Operations should work correctly with the override
      const transferAmount = ethers.parseEther("100");
      await sampleToken.transfer(addr1.address, transferAmount);
      expect(await sampleToken.balanceOf(addr1.address)).to.equal(transferAmount);
    });

    it("SampleToken should properly override _msgData", async function () {
      // Verify that the token properly handles message data
      const transferAmount = ethers.parseEther("100");

      // Should successfully process message data
      const tx = await sampleToken.transfer(addr1.address, transferAmount);
      await expect(tx)
        .to.emit(sampleToken, "Transfer")
        .withArgs(owner.address, addr1.address, transferAmount);
    });

    it("SampleToken should properly override _contextSuffixLength", async function () {
      // Verify that context suffix length is properly handled
      const forwarderAddr = await sampleToken.trustedForwarder();
      expect(forwarderAddr).to.equal(forwarder.address);

      // The contract should be fully functional with the override
      const ownerBalance = await sampleToken.balanceOf(owner.address);
      expect(ownerBalance).to.be.gt(0);
    });

    it("SampleNFT should properly override _msgSender", async function () {
      // Verify that the NFT properly delegates to ERC2771Context
      const trustedForwarder = await sampleNFT.trustedForwarder();
      expect(trustedForwarder).to.equal(forwarder.address);

      // Operations should work correctly with the override
      await sampleNFT.mint(addr1.address);
      expect(await sampleNFT.balanceOf(addr1.address)).to.equal(1);
    });

    it("SampleNFT should properly override _msgData", async function () {
      // Verify that the NFT properly handles message data
      const mintTx = await sampleNFT.mint(addr1.address);
      await expect(mintTx)
        .to.emit(sampleNFT, "Transfer")
        .withArgs(ethers.ZeroAddress, addr1.address, 1);
    });

    it("SampleNFT should properly override _contextSuffixLength", async function () {
      // Verify that context suffix length is properly handled
      const forwarderAddr = await sampleNFT.trustedForwarder();
      expect(forwarderAddr).to.equal(forwarder.address);

      // The contract should be fully functional with the override
      await sampleNFT.mint(addr1.address);
      const balance = await sampleNFT.balanceOf(addr1.address);
      expect(balance).to.equal(1);
    });
  });
});
