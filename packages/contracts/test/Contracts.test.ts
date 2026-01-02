import { expect } from "chai";
import { ethers } from "hardhat";
import { SampleToken, SampleNFT } from "../typechain-types";

describe("Smart Contracts - Core Functionality", function () {
  let sampleToken: SampleToken;
  let sampleNFT: SampleNFT;
  let owner: any;
  let user1: any;
  let user2: any;
  let forwarder: any;

  beforeEach(async function () {
    [owner, user1, user2, forwarder] = await ethers.getSigners();

    // Deploy SampleToken with separate forwarder (NOT owner to avoid ERC2771 calldata extraction issues)
    const TokenFactory = await ethers.getContractFactory("SampleToken");
    sampleToken = await TokenFactory.connect(owner).deploy(forwarder.address);
    await sampleToken.waitForDeployment();

    // Deploy SampleNFT with separate forwarder (NOT owner to avoid ERC2771 calldata extraction issues)
    const NFTFactory = await ethers.getContractFactory("SampleNFT");
    sampleNFT = await NFTFactory.connect(owner).deploy(forwarder.address);
    await sampleNFT.waitForDeployment();
  });

  describe("SampleToken - Basic ERC20 Functions", function () {
    it("Should deploy with correct name and symbol", async function () {
      expect(await sampleToken.name()).to.equal("Sample Token");
      expect(await sampleToken.symbol()).to.equal("SMPL");
      expect(await sampleToken.decimals()).to.equal(18);
    });

    it("Should have initial supply minted to owner", async function () {
      const initialSupply = ethers.parseEther("1000000");
      expect(await sampleToken.balanceOf(owner.address)).to.equal(initialSupply);
      expect(await sampleToken.totalSupply()).to.equal(initialSupply);
    });

    it("Should transfer tokens correctly", async function () {
      const amount = ethers.parseEther("100");
      await sampleToken.connect(owner).transfer(user1.address, amount);

      expect(await sampleToken.balanceOf(user1.address)).to.equal(amount);
      expect(await sampleToken.balanceOf(owner.address)).to.equal(
        ethers.parseEther("999900")
      );
    });

    it("Should handle approvals and transferFrom", async function () {
      const amount = ethers.parseEther("100");

      // First transfer some tokens to user1
      await sampleToken.connect(owner).transfer(user1.address, ethers.parseEther("500"));

      // Approve user2 to spend tokens
      await sampleToken.connect(user1).approve(user2.address, amount);
      expect(await sampleToken.allowance(user1.address, user2.address)).to.equal(amount);

      // user2 transfers on behalf of user1
      await sampleToken
        .connect(user2)
        .transferFrom(user1.address, user2.address, amount);

      expect(await sampleToken.balanceOf(user2.address)).to.equal(amount);
    });

    it("Should handle minting", async function () {
      const mintAmount = ethers.parseEther("1000");
      await sampleToken.connect(owner).mint(user1.address, mintAmount);

      expect(await sampleToken.balanceOf(user1.address)).to.equal(mintAmount);
    });

    it("Should handle burning", async function () {
      const burnAmount = ethers.parseEther("100");
      const initialSupply = await sampleToken.totalSupply();

      await sampleToken.connect(owner).burn(burnAmount);

      expect(await sampleToken.totalSupply()).to.equal(initialSupply - burnAmount);
    });

    it("Should pause and unpause", async function () {
      expect(await sampleToken.paused()).to.equal(false);

      await sampleToken.connect(owner).pause();
      expect(await sampleToken.paused()).to.equal(true);

      await sampleToken.connect(owner).unpause();
      expect(await sampleToken.paused()).to.equal(false);
    });

    it("Should prevent transfers when paused", async function () {
      await sampleToken.connect(owner).pause();

      await expect(
        sampleToken.connect(owner).transfer(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(sampleToken, "EnforcedPause");
    });
  });

  describe("SampleNFT - Basic ERC721 Functions", function () {
    it("Should deploy with correct name and symbol", async function () {
      expect(await sampleNFT.name()).to.equal("Sample NFT");
      expect(await sampleNFT.symbol()).to.equal("SNFT");
    });

    it("Should start with zero total supply", async function () {
      expect(await sampleNFT.totalSupply()).to.equal(0);
    });

    it("Should mint NFTs correctly", async function () {
      await sampleNFT.connect(owner).mint(user1.address);

      expect(await sampleNFT.balanceOf(user1.address)).to.equal(1);
      expect(await sampleNFT.ownerOf(1)).to.equal(user1.address);
      expect(await sampleNFT.totalSupply()).to.equal(1);
    });

    it("Should transfer NFTs correctly", async function () {
      await sampleNFT.connect(owner).mint(owner.address);

      await sampleNFT
        .connect(owner)
        .transferFrom(owner.address, user1.address, 1);

      expect(await sampleNFT.ownerOf(1)).to.equal(user1.address);
    });

    it("Should handle approvals", async function () {
      await sampleNFT.connect(owner).mint(owner.address);

      await sampleNFT.connect(owner).approve(user1.address, 1);
      expect(await sampleNFT.getApproved(1)).to.equal(user1.address);
    });

    it("Should handle setApprovalForAll", async function () {
      await sampleNFT.connect(owner).setApprovalForAll(user1.address, true);
      expect(await sampleNFT.isApprovedForAll(owner.address, user1.address)).to.equal(true);
    });

    it("Should burn NFTs", async function () {
      await sampleNFT.connect(owner).mint(owner.address);
      const initialSupply = await sampleNFT.totalSupply();

      await sampleNFT.connect(owner).burn(1);

      expect(await sampleNFT.totalSupply()).to.equal(initialSupply - 1n);
    });

    it("Should enumerate tokens", async function () {
      await sampleNFT.connect(owner).mint(user1.address);
      await sampleNFT.connect(owner).mint(user2.address);

      expect(await sampleNFT.balanceOf(user1.address)).to.equal(1);
      expect(await sampleNFT.balanceOf(user2.address)).to.equal(1);
      expect(await sampleNFT.totalSupply()).to.equal(2);
    });
  });

  describe("ERC2771Context - Meta-transaction Support", function () {
    it("SampleToken should have trusted forwarder", async function () {
      expect(await sampleToken.trustedForwarder()).to.equal(forwarder.address);
      expect(await sampleToken.getTrustedForwarder()).to.equal(forwarder.address);
    });

    it("SampleNFT should have trusted forwarder", async function () {
      expect(await sampleNFT.trustedForwarder()).to.equal(forwarder.address);
      expect(await sampleNFT.getTrustedForwarder()).to.equal(forwarder.address);
    });

    it("Should deploy with custom forwarder", async function () {
      const TokenFactory = await ethers.getContractFactory("SampleToken");
      const token = await TokenFactory.connect(owner).deploy(forwarder.address);
      await token.waitForDeployment();

      expect(await token.getTrustedForwarder()).to.equal(forwarder.address);
    });

    it("Should handle zero address forwarder", async function () {
      const TokenFactory = await ethers.getContractFactory("SampleToken");
      const token = await TokenFactory.connect(owner).deploy(ethers.ZeroAddress);
      await token.waitForDeployment();

      expect(await token.getTrustedForwarder()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Ownership and Access Control", function () {
    it("Token owner should be able to mint", async function () {
      expect(await sampleToken.owner()).to.equal(owner.address);

      const amount = ethers.parseEther("1000");
      await sampleToken.connect(owner).mint(user1.address, amount);

      expect(await sampleToken.balanceOf(user1.address)).to.equal(amount);
    });

    it("Non-owner should not be able to mint token", async function () {
      await expect(
        sampleToken.connect(user1).mint(user1.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(sampleToken, "OwnableUnauthorizedAccount");
    });

    it("NFT owner should be able to mint", async function () {
      expect(await sampleNFT.owner()).to.equal(owner.address);

      await sampleNFT.connect(owner).mint(user1.address);
      expect(await sampleNFT.balanceOf(user1.address)).to.equal(1);
    });

    it("Non-owner should not be able to mint NFT", async function () {
      await expect(
        sampleNFT.connect(user1).mint(user1.address)
      ).to.be.revertedWithCustomError(sampleNFT, "OwnableUnauthorizedAccount");
    });
  });

  describe("Error Handling", function () {
    it("Should fail transfer with insufficient balance", async function () {
      const amount = ethers.parseEther("9999999999");

      await expect(
        sampleToken.connect(owner).transfer(user1.address, amount)
      ).to.be.revertedWithCustomError(sampleToken, "ERC20InsufficientBalance");
    });

    it("Should fail transferFrom with insufficient allowance", async function () {
      await sampleToken.connect(owner).transfer(user1.address, ethers.parseEther("100"));

      await sampleToken.connect(user1).approve(user2.address, ethers.parseEther("50"));

      await expect(
        sampleToken
          .connect(user2)
          .transferFrom(user1.address, user2.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(sampleToken, "ERC20InsufficientAllowance");
    });

    it("Should fail NFT transfer of non-existent token", async function () {
      await expect(
        sampleNFT.connect(owner).transferFrom(owner.address, user1.address, 999)
      ).to.be.revertedWithCustomError(sampleNFT, "ERC721NonexistentToken");
    });

    it("Should fail NFT transfer without approval", async function () {
      await sampleNFT.connect(owner).mint(owner.address);

      await expect(
        sampleNFT.connect(user1).transferFrom(owner.address, user1.address, 1)
      ).to.be.revertedWithCustomError(sampleNFT, "ERC721InsufficientApproval");
    });
  });

  describe("Event Emission", function () {
    it("Should emit Transfer event on token transfer", async function () {
      const amount = ethers.parseEther("100");

      await expect(sampleToken.connect(owner).transfer(user1.address, amount))
        .to.emit(sampleToken, "Transfer")
        .withArgs(owner.address, user1.address, amount);
    });

    it("Should emit Approval event on token approval", async function () {
      const amount = ethers.parseEther("100");

      await expect(sampleToken.connect(owner).approve(user1.address, amount))
        .to.emit(sampleToken, "Approval")
        .withArgs(owner.address, user1.address, amount);
    });

    it("Should emit Transfer event on NFT transfer", async function () {
      await sampleNFT.connect(owner).mint(owner.address);

      await expect(sampleNFT.connect(owner).transferFrom(owner.address, user1.address, 1))
        .to.emit(sampleNFT, "Transfer")
        .withArgs(owner.address, user1.address, 1);
    });

    it("Should emit Approval event on NFT approval", async function () {
      await sampleNFT.connect(owner).mint(owner.address);

      await expect(sampleNFT.connect(owner).approve(user1.address, 1))
        .to.emit(sampleNFT, "Approval")
        .withArgs(owner.address, user1.address, 1);
    });

    it("Should emit Paused event", async function () {
      await expect(sampleToken.connect(owner).pause())
        .to.emit(sampleToken, "Paused")
        .withArgs(owner.address);
    });

    it("Should emit Unpaused event", async function () {
      await sampleToken.connect(owner).pause();

      await expect(sampleToken.connect(owner).unpause())
        .to.emit(sampleToken, "Unpaused")
        .withArgs(owner.address);
    });
  });

  describe("Comprehensive Coverage Tests", function () {
    it("Should execute multiple operations in sequence", async function () {
      // Mint additional tokens
      await sampleToken.connect(owner).mint(user1.address, ethers.parseEther("500"));
      expect(await sampleToken.balanceOf(user1.address)).to.equal(ethers.parseEther("500"));

      // Transfer tokens
      await sampleToken.connect(user1).transfer(user2.address, ethers.parseEther("250"));
      expect(await sampleToken.balanceOf(user2.address)).to.equal(ethers.parseEther("250"));

      // Burn tokens
      await sampleToken.connect(user2).burn(ethers.parseEther("100"));
      expect(await sampleToken.balanceOf(user2.address)).to.equal(ethers.parseEther("150"));
    });

    it("Should handle NFT operations comprehensively", async function () {
      // Mint multiple NFTs
      for (let i = 0; i < 3; i++) {
        await sampleNFT.connect(owner).mint(owner.address);
      }
      expect(await sampleNFT.balanceOf(owner.address)).to.equal(3);

      // Transfer NFTs
      await sampleNFT.connect(owner).transferFrom(owner.address, user1.address, 1);
      expect(await sampleNFT.ownerOf(1)).to.equal(user1.address);

      // Burn NFT
      await sampleNFT.connect(owner).burn(2);
      expect(await sampleNFT.totalSupply()).to.equal(2);

      // Approve and transfer
      await sampleNFT.connect(user1).approve(user2.address, 1);
      await sampleNFT.connect(user2).transferFrom(user1.address, owner.address, 1);
      expect(await sampleNFT.ownerOf(1)).to.equal(owner.address);
    });

    it("Should handle token operations with approval", async function () {
      // Set up initial balances
      await sampleToken.connect(owner).transfer(user1.address, ethers.parseEther("1000"));

      // Create allowance and execute transfer
      await sampleToken.connect(user1).approve(user2.address, ethers.parseEther("500"));
      await sampleToken
        .connect(user2)
        .transferFrom(user1.address, user2.address, ethers.parseEther("300"));

      // Verify final balances
      expect(await sampleToken.balanceOf(user2.address)).to.equal(ethers.parseEther("300"));
      expect(await sampleToken.allowance(user1.address, user2.address)).to.equal(
        ethers.parseEther("200")
      );
    });

    it("Should verify trusted forwarder setup", async function () {
      // Verify forwarder is set correctly (NOT owner)
      expect(await sampleToken.trustedForwarder()).to.equal(forwarder.address);
      expect(await sampleNFT.trustedForwarder()).to.equal(forwarder.address);

      // Verify getTrustedForwarder returns correct address
      expect(await sampleToken.getTrustedForwarder()).to.equal(forwarder.address);
      expect(await sampleNFT.getTrustedForwarder()).to.equal(forwarder.address);
    });

    it("Should verify nonces function", async function () {
      const nonces = await sampleToken.nonces(owner.address);
      expect(nonces).to.equal(0);
    });

    it("Should handle token pause and unpause with transfers", async function () {
      const amount = ethers.parseEther("100");

      // Verify can transfer when not paused
      await sampleToken.connect(owner).transfer(user1.address, amount);
      expect(await sampleToken.balanceOf(user1.address)).to.equal(amount);

      // Pause and verify cannot transfer
      await sampleToken.connect(owner).pause();
      await expect(
        sampleToken.connect(owner).transfer(user2.address, amount)
      ).to.be.revertedWithCustomError(sampleToken, "EnforcedPause");

      // Unpause and verify can transfer again
      await sampleToken.connect(owner).unpause();
      await sampleToken.connect(owner).transfer(user2.address, amount);
      expect(await sampleToken.balanceOf(user2.address)).to.equal(amount);
    });
  });
});
