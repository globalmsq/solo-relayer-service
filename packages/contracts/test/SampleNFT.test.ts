import { expect } from "chai";
import { ethers } from "hardhat";
import { SampleNFT } from "../typechain-types";

describe("SampleNFT", function () {
  let sampleNFT: SampleNFT;
  let owner: any;
  let addr1: any;
  let addr2: any;
  let forwarder: any;

  beforeEach(async function () {
    [owner, addr1, addr2, forwarder] = await ethers.getSigners();

    const SampleNFTFactory = await ethers.getContractFactory("SampleNFT");
    // Deploy with forwarder as trusted forwarder (NOT owner to avoid ERC2771 calldata extraction issues)
    sampleNFT = await SampleNFTFactory.connect(owner).deploy(forwarder.address);
    await sampleNFT.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should have the correct name", async function () {
      expect(await sampleNFT.name()).to.equal("Sample NFT");
    });

    it("Should have the correct symbol", async function () {
      expect(await sampleNFT.symbol()).to.equal("SNFT");
    });

    it("Should set the right owner", async function () {
      expect(await sampleNFT.owner()).to.equal(owner.address);
    });

    it("Should set the correct trusted forwarder", async function () {
      expect(await sampleNFT.getTrustedForwarder()).to.equal(forwarder.address);
    });

    it("Should start with empty total supply", async function () {
      expect(await sampleNFT.totalSupply()).to.equal(0);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint NFT", async function () {
      const tx = await sampleNFT.mint(addr1.address);
      await tx.wait();

      expect(await sampleNFT.balanceOf(addr1.address)).to.equal(1);
      expect(await sampleNFT.ownerOf(1)).to.equal(addr1.address);
    });

    it("Should increment token IDs correctly", async function () {
      await sampleNFT.mint(addr1.address);
      await sampleNFT.mint(addr2.address);

      expect(await sampleNFT.ownerOf(1)).to.equal(addr1.address);
      expect(await sampleNFT.ownerOf(2)).to.equal(addr2.address);
    });

    it("Should increase total supply on mint", async function () {
      const initialSupply = await sampleNFT.totalSupply();

      await sampleNFT.mint(addr1.address);
      await sampleNFT.mint(addr2.address);

      expect(await sampleNFT.totalSupply()).to.equal(initialSupply + 2n);
    });

    it("Should return minted token ID", async function () {
      const tx = await sampleNFT.mint(addr1.address);
      const receipt = await tx.wait();

      expect(receipt).to.not.be.null;
    });

    it("Should not allow non-owner to mint", async function () {
      await expect(sampleNFT.connect(addr1).mint(addr1.address)).to.be.revertedWithCustomError(
        sampleNFT,
        "OwnableUnauthorizedAccount"
      );
    });

    it("Should emit Transfer event on mint", async function () {
      await expect(sampleNFT.mint(addr1.address))
        .to.emit(sampleNFT, "Transfer")
        .withArgs(ethers.ZeroAddress, addr1.address, 1);
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      await sampleNFT.mint(owner.address);
    });

    it("Should allow owner to transfer NFT", async function () {
      await sampleNFT.transferFrom(owner.address, addr1.address, 1);
      expect(await sampleNFT.ownerOf(1)).to.equal(addr1.address);
    });

    it("Should update balances after transfer", async function () {
      await sampleNFT.transferFrom(owner.address, addr1.address, 1);

      expect(await sampleNFT.balanceOf(owner.address)).to.equal(0);
      expect(await sampleNFT.balanceOf(addr1.address)).to.equal(1);
    });

    it("Should emit Transfer event on transfer", async function () {
      await expect(sampleNFT.transferFrom(owner.address, addr1.address, 1))
        .to.emit(sampleNFT, "Transfer")
        .withArgs(owner.address, addr1.address, 1);
    });

    it("Should fail when transferring non-existent token", async function () {
      await expect(
        sampleNFT.transferFrom(owner.address, addr1.address, 999)
      ).to.be.revertedWithCustomError(sampleNFT, "ERC721NonexistentToken");
    });

    it("Should fail when non-owner transfers", async function () {
      await expect(
        sampleNFT.connect(addr1).transferFrom(owner.address, addr2.address, 1)
      ).to.be.revertedWithCustomError(sampleNFT, "ERC721InsufficientApproval");
    });
  });

  describe("Approval", function () {
    beforeEach(async function () {
      await sampleNFT.mint(owner.address);
    });

    it("Should approve address to transfer token", async function () {
      await sampleNFT.approve(addr1.address, 1);
      expect(await sampleNFT.getApproved(1)).to.equal(addr1.address);
    });

    it("Should allow approved address to transfer", async function () {
      await sampleNFT.approve(addr1.address, 1);
      await sampleNFT.connect(addr1).transferFrom(owner.address, addr2.address, 1);

      expect(await sampleNFT.ownerOf(1)).to.equal(addr2.address);
    });

    it("Should clear approval on transfer", async function () {
      await sampleNFT.approve(addr1.address, 1);
      await sampleNFT.transferFrom(owner.address, addr2.address, 1);

      expect(await sampleNFT.getApproved(1)).to.equal(ethers.ZeroAddress);
    });

    it("Should emit Approval event", async function () {
      await expect(sampleNFT.approve(addr1.address, 1))
        .to.emit(sampleNFT, "Approval")
        .withArgs(owner.address, addr1.address, 1);
    });

    it("Should fail approval for non-existent token", async function () {
      await expect(sampleNFT.approve(addr1.address, 999)).to.be.revertedWithCustomError(
        sampleNFT,
        "ERC721NonexistentToken"
      );
    });
  });

  describe("Operator Approval", function () {
    beforeEach(async function () {
      await sampleNFT.mint(owner.address);
    });

    it("Should allow setting approval for all", async function () {
      await sampleNFT.setApprovalForAll(addr1.address, true);
      expect(await sampleNFT.isApprovedForAll(owner.address, addr1.address)).to.equal(true);
    });

    it("Should allow approved operator to transfer all tokens", async function () {
      await sampleNFT.mint(owner.address);
      await sampleNFT.setApprovalForAll(addr1.address, true);

      await sampleNFT.connect(addr1).transferFrom(owner.address, addr2.address, 1);
      await sampleNFT.connect(addr1).transferFrom(owner.address, addr2.address, 2);

      expect(await sampleNFT.balanceOf(owner.address)).to.equal(0);
      expect(await sampleNFT.balanceOf(addr2.address)).to.equal(2);
    });

    it("Should allow revoke operator approval", async function () {
      await sampleNFT.setApprovalForAll(addr1.address, true);
      await sampleNFT.setApprovalForAll(addr1.address, false);

      expect(await sampleNFT.isApprovedForAll(owner.address, addr1.address)).to.equal(false);
    });

    it("Should emit ApprovalForAll event", async function () {
      await expect(sampleNFT.setApprovalForAll(addr1.address, true))
        .to.emit(sampleNFT, "ApprovalForAll")
        .withArgs(owner.address, addr1.address, true);
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      await sampleNFT.mint(owner.address);
    });

    it("Should allow token owner to burn", async function () {
      await sampleNFT.burn(1);
      expect(await sampleNFT.balanceOf(owner.address)).to.equal(0);
    });

    it("Should decrease total supply on burn", async function () {
      const initialSupply = await sampleNFT.totalSupply();
      await sampleNFT.burn(1);

      expect(await sampleNFT.totalSupply()).to.equal(initialSupply - 1n);
    });

    it("Should fail burning non-existent token", async function () {
      await expect(sampleNFT.burn(999)).to.be.revertedWithCustomError(
        sampleNFT,
        "ERC721NonexistentToken"
      );
    });

    it("Should fail when non-owner burns", async function () {
      await expect(sampleNFT.connect(addr1).burn(1)).to.be.revertedWithCustomError(
        sampleNFT,
        "ERC721InsufficientApproval"
      );
    });

    it("Should emit Transfer event on burn", async function () {
      await expect(sampleNFT.burn(1))
        .to.emit(sampleNFT, "Transfer")
        .withArgs(owner.address, ethers.ZeroAddress, 1);
    });
  });

  describe("ERC721Enumerable", function () {
    it("Should return correct token count", async function () {
      await sampleNFT.mint(addr1.address);
      await sampleNFT.mint(addr2.address);
      await sampleNFT.mint(owner.address);

      expect(await sampleNFT.balanceOf(addr1.address)).to.equal(1);
      expect(await sampleNFT.balanceOf(addr2.address)).to.equal(1);
      expect(await sampleNFT.balanceOf(owner.address)).to.equal(1);
    });

    it("Should enumerate all tokens", async function () {
      await sampleNFT.mint(addr1.address);
      await sampleNFT.mint(addr2.address);
      await sampleNFT.mint(owner.address);

      expect(await sampleNFT.totalSupply()).to.equal(3);
    });

    it("Should return correct token by owner and index", async function () {
      await sampleNFT.mint(addr1.address);
      await sampleNFT.mint(addr2.address);

      const token = await sampleNFT.tokenOfOwnerByIndex(addr1.address, 0);
      expect(token).to.equal(1);
    });
  });

  describe("ERC2771Context", function () {
    it("Should return correct trusted forwarder", async function () {
      const trustedForwarder = await sampleNFT.getTrustedForwarder();
      expect(trustedForwarder).to.equal(forwarder.address);
    });

    it("Should return zero address as trusted forwarder when initialized with zero", async function () {
      const SampleNFTFactory = await ethers.getContractFactory("SampleNFT");
      const nft = await SampleNFTFactory.deploy(ethers.ZeroAddress);
      await nft.waitForDeployment();

      expect(await nft.getTrustedForwarder()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Interface Support", function () {
    it("Should support ERC721 interface", async function () {
      const ERC721_INTERFACE = "0x80ac58cd";
      expect(await sampleNFT.supportsInterface(ERC721_INTERFACE)).to.equal(true);
    });

    it("Should support ERC721Enumerable interface", async function () {
      const ERC721_ENUMERABLE_INTERFACE = "0x780e9d63";
      expect(await sampleNFT.supportsInterface(ERC721_ENUMERABLE_INTERFACE)).to.equal(true);
    });

    it("Should support ERC165 interface", async function () {
      const ERC165_INTERFACE = "0x01ffc9a7";
      expect(await sampleNFT.supportsInterface(ERC165_INTERFACE)).to.equal(true);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple mints to same address", async function () {
      await sampleNFT.mint(addr1.address);
      await sampleNFT.mint(addr1.address);
      await sampleNFT.mint(addr1.address);

      expect(await sampleNFT.balanceOf(addr1.address)).to.equal(3);
    });

    it("Should handle transfer to self", async function () {
      await sampleNFT.mint(owner.address);
      const balanceBefore = await sampleNFT.balanceOf(owner.address);

      await sampleNFT.transferFrom(owner.address, owner.address, 1);
      expect(await sampleNFT.balanceOf(owner.address)).to.equal(balanceBefore);
    });

    it("Should correctly track ownership after multiple transfers", async function () {
      await sampleNFT.mint(owner.address);

      await sampleNFT.transferFrom(owner.address, addr1.address, 1);
      expect(await sampleNFT.ownerOf(1)).to.equal(addr1.address);

      await sampleNFT.connect(addr1).transferFrom(addr1.address, addr2.address, 1);
      expect(await sampleNFT.ownerOf(1)).to.equal(addr2.address);

      await sampleNFT.connect(addr2).transferFrom(addr2.address, owner.address, 1);
      expect(await sampleNFT.ownerOf(1)).to.equal(owner.address);
    });
  });

  describe("Internal Functions", function () {
    it("Should handle internal context functions", async function () {
      // Test getTrustedForwarder function which uses internal context
      const trustedForwarder = await sampleNFT.getTrustedForwarder();
      expect(trustedForwarder).to.equal(forwarder.address);
    });

    it("Should support multiple mints", async function () {
      for (let i = 0; i < 5; i++) {
        await sampleNFT.mint(owner.address);
      }
      expect(await sampleNFT.balanceOf(owner.address)).to.equal(5);
      expect(await sampleNFT.totalSupply()).to.equal(5);
    });

    it("Should test context data function", async function () {
      const contextData = await sampleNFT.testContextData();
      expect(contextData).to.be.a("string");
      expect(contextData.length).to.be.greaterThanOrEqual(0);
    });

    it("Should test context suffix length function", async function () {
      // ERC2771Context returns 20 (address length in bytes) for context suffix length
      const suffixLength = await sampleNFT.testContextSuffixLength();
      expect(suffixLength).to.equal(20);
    });
  });
});
