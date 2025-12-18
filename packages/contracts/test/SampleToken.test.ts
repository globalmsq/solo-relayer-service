import { expect } from "chai";
import { ethers } from "hardhat";
import { SampleToken } from "../typechain-types";

describe("SampleToken", function () {
  let sampleToken: SampleToken;
  let owner: any;
  let addr1: any;
  let addr2: any;
  const INITIAL_SUPPLY = ethers.parseEther("1000000");

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const SampleTokenFactory = await ethers.getContractFactory("SampleToken");
    // Deploy with owner as the signer (who becomes msg.sender)
    sampleToken = await SampleTokenFactory.connect(owner).deploy(owner.address);
    await sampleToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should have the correct name", async function () {
      expect(await sampleToken.name()).to.equal("Sample Token");
    });

    it("Should have the correct symbol", async function () {
      expect(await sampleToken.symbol()).to.equal("SMPL");
    });

    it("Should have the correct number of decimals", async function () {
      expect(await sampleToken.decimals()).to.equal(18);
    });

    it("Should mint initial supply to deployer", async function () {
      expect(await sampleToken.balanceOf(owner.address)).to.equal(INITIAL_SUPPLY);
    });

    it("Should have correct total supply", async function () {
      expect(await sampleToken.totalSupply()).to.equal(INITIAL_SUPPLY);
    });

    it("Should set the right owner", async function () {
      expect(await sampleToken.owner()).to.equal(owner.address);
    });

    it("Should set the correct trusted forwarder", async function () {
      expect(await sampleToken.getTrustedForwarder()).to.equal(owner.address);
    });
  });

  describe("Token Transfers", function () {
    it("Should transfer tokens between accounts", async function () {
      const transferAmount = ethers.parseEther("100");
      await sampleToken.transfer(addr1.address, transferAmount);
      expect(await sampleToken.balanceOf(addr1.address)).to.equal(transferAmount);
    });

    it("Should fail transfer when balance is insufficient", async function () {
      const transferAmount = ethers.parseEther("1000000000");
      await expect(
        sampleToken.transfer(addr1.address, transferAmount)
      ).to.be.revertedWithCustomError(sampleToken, "ERC20InsufficientBalance");
    });

    it("Should update balances after transfer", async function () {
      const transferAmount = ethers.parseEther("100");
      const initialOwnerBalance = await sampleToken.balanceOf(owner.address);

      await sampleToken.transfer(addr1.address, transferAmount);

      expect(await sampleToken.balanceOf(owner.address)).to.equal(
        initialOwnerBalance - transferAmount
      );
      expect(await sampleToken.balanceOf(addr1.address)).to.equal(transferAmount);
    });

    it("Should allow approved address to transfer tokens", async function () {
      const transferAmount = ethers.parseEther("100");
      const approveAmount = ethers.parseEther("200");

      await sampleToken.approve(addr1.address, approveAmount);
      await sampleToken
        .connect(addr1)
        .transferFrom(owner.address, addr2.address, transferAmount);

      expect(await sampleToken.balanceOf(addr2.address)).to.equal(transferAmount);
    });

    it("Should emit Transfer event", async function () {
      const transferAmount = ethers.parseEther("100");
      await expect(sampleToken.transfer(addr1.address, transferAmount))
        .to.emit(sampleToken, "Transfer")
        .withArgs(owner.address, addr1.address, transferAmount);
    });
  });

  describe("Approval", function () {
    it("Should approve token spending", async function () {
      const approveAmount = ethers.parseEther("100");
      await sampleToken.approve(addr1.address, approveAmount);
      expect(await sampleToken.allowance(owner.address, addr1.address)).to.equal(
        approveAmount
      );
    });

    it("Should update allowance on approve", async function () {
      const initialAmount = ethers.parseEther("100");
      const newAmount = ethers.parseEther("200");

      await sampleToken.approve(addr1.address, initialAmount);
      await sampleToken.approve(addr1.address, newAmount);

      expect(await sampleToken.allowance(owner.address, addr1.address)).to.equal(
        newAmount
      );
    });

    it("Should emit Approval event", async function () {
      const approveAmount = ethers.parseEther("100");
      await expect(sampleToken.approve(addr1.address, approveAmount))
        .to.emit(sampleToken, "Approval")
        .withArgs(owner.address, addr1.address, approveAmount);
    });

    it("Should fail transferFrom when allowance is insufficient", async function () {
      const transferAmount = ethers.parseEther("100");
      const approveAmount = ethers.parseEther("50");

      await sampleToken.approve(addr1.address, approveAmount);
      await expect(
        sampleToken
          .connect(addr1)
          .transferFrom(owner.address, addr2.address, transferAmount)
      ).to.be.revertedWithCustomError(sampleToken, "ERC20InsufficientAllowance");
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("1000");
      await sampleToken.mint(addr1.address, mintAmount);
      expect(await sampleToken.balanceOf(addr1.address)).to.equal(mintAmount);
    });

    it("Should increase total supply on mint", async function () {
      const mintAmount = ethers.parseEther("1000");
      const initialSupply = await sampleToken.totalSupply();

      await sampleToken.mint(addr1.address, mintAmount);
      expect(await sampleToken.totalSupply()).to.equal(initialSupply + mintAmount);
    });

    it("Should not allow non-owner to mint", async function () {
      const mintAmount = ethers.parseEther("1000");
      await expect(
        sampleToken.connect(addr1).mint(addr1.address, mintAmount)
      ).to.be.revertedWithCustomError(sampleToken, "OwnableUnauthorizedAccount");
    });

    it("Should emit Transfer event on mint", async function () {
      const mintAmount = ethers.parseEther("1000");
      await expect(sampleToken.mint(addr1.address, mintAmount))
        .to.emit(sampleToken, "Transfer")
        .withArgs(ethers.ZeroAddress, addr1.address, mintAmount);
    });
  });

  describe("Burning", function () {
    it("Should allow burning tokens", async function () {
      const burnAmount = ethers.parseEther("100");
      await sampleToken.transfer(addr1.address, burnAmount);

      const balanceBefore = await sampleToken.balanceOf(addr1.address);
      await sampleToken.connect(addr1).burn(burnAmount);

      expect(await sampleToken.balanceOf(addr1.address)).to.equal(
        balanceBefore - burnAmount
      );
    });

    it("Should decrease total supply on burn", async function () {
      const burnAmount = ethers.parseEther("100");
      const initialSupply = await sampleToken.totalSupply();

      await sampleToken.burn(burnAmount);
      expect(await sampleToken.totalSupply()).to.equal(initialSupply - burnAmount);
    });

    it("Should fail when burning more than balance", async function () {
      const burnAmount = ethers.parseEther("100");
      await sampleToken.transfer(addr1.address, burnAmount);

      const excessAmount = ethers.parseEther("200");
      await expect(
        sampleToken.connect(addr1).burn(excessAmount)
      ).to.be.revertedWithCustomError(sampleToken, "ERC20InsufficientBalance");
    });

    it("Should emit Transfer event on burn", async function () {
      const burnAmount = ethers.parseEther("100");
      await expect(sampleToken.burn(burnAmount))
        .to.emit(sampleToken, "Transfer")
        .withArgs(owner.address, ethers.ZeroAddress, burnAmount);
    });
  });

  describe("Pausable", function () {
    it("Should allow owner to pause", async function () {
      await sampleToken.pause();
      expect(await sampleToken.paused()).to.equal(true);
    });

    it("Should allow owner to unpause", async function () {
      await sampleToken.pause();
      await sampleToken.unpause();
      expect(await sampleToken.paused()).to.equal(false);
    });

    it("Should prevent transfers when paused", async function () {
      const transferAmount = ethers.parseEther("100");
      await sampleToken.pause();

      await expect(
        sampleToken.transfer(addr1.address, transferAmount)
      ).to.be.revertedWithCustomError(sampleToken, "EnforcedPause");
    });

    it("Should not allow non-owner to pause", async function () {
      await expect(sampleToken.connect(addr1).pause()).to.be.revertedWithCustomError(
        sampleToken,
        "OwnableUnauthorizedAccount"
      );
    });

    it("Should emit Paused event", async function () {
      await expect(sampleToken.pause())
        .to.emit(sampleToken, "Paused")
        .withArgs(owner.address);
    });

    it("Should emit Unpaused event", async function () {
      await sampleToken.pause();
      await expect(sampleToken.unpause())
        .to.emit(sampleToken, "Unpaused")
        .withArgs(owner.address);
    });
  });

  describe("ERC2771Context", function () {
    it("Should return correct trusted forwarder", async function () {
      const forwarder = await sampleToken.getTrustedForwarder();
      expect(forwarder).to.equal(owner.address);
    });

    it("Should return zero address as trusted forwarder when initialized with zero", async function () {
      const SampleTokenFactory = await ethers.getContractFactory("SampleToken");
      const token = await SampleTokenFactory.deploy(ethers.ZeroAddress);
      await token.waitForDeployment();

      expect(await token.getTrustedForwarder()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero amount transfer", async function () {
      const zeroAmount = ethers.parseEther("0");
      // Verify not paused
      const isPaused = await sampleToken.paused();
      if (isPaused) {
        await sampleToken.unpause();
      }

      const addr1BalanceBefore = await sampleToken.balanceOf(addr1.address);
      await sampleToken.transfer(addr1.address, zeroAmount);
      expect(await sampleToken.balanceOf(addr1.address)).to.equal(addr1BalanceBefore);
    });

    it("Should handle transfer to self", async function () {
      const transferAmount = ethers.parseEther("100");
      // Verify not paused
      const isPaused = await sampleToken.paused();
      if (isPaused) {
        await sampleToken.unpause();
      }

      const balanceBefore = await sampleToken.balanceOf(owner.address);
      await sampleToken.transfer(owner.address, transferAmount);
      expect(await sampleToken.balanceOf(owner.address)).to.equal(balanceBefore);
    });

    it("Should handle large amounts safely", async function () {
      const largeAmount = ethers.parseEther("100000");
      // Verify not paused
      const isPaused = await sampleToken.paused();
      if (isPaused) {
        await sampleToken.unpause();
      }

      // Verify owner has enough balance
      const ownerBalance = await sampleToken.balanceOf(owner.address);
      expect(ownerBalance).to.be.gte(largeAmount);

      await sampleToken.transfer(addr1.address, largeAmount);
      expect(await sampleToken.balanceOf(addr1.address)).to.equal(largeAmount);
    });
  });

  describe("Internal Functions", function () {
    it("Should have nonces function that returns 0", async function () {
      const nonce = await sampleToken.nonces(owner.address);
      expect(nonce).to.equal(0);
    });

    it("Should handle internal context functions", async function () {
      // Test getTrustedForwarder function which uses internal context
      const forwarder = await sampleToken.getTrustedForwarder();
      expect(forwarder).to.equal(owner.address);
    });

    it("Should test context data function", async function () {
      const contextData = await sampleToken.testContextData();
      expect(contextData).to.be.a("string");
      expect(contextData.length).to.be.greaterThanOrEqual(0);
    });

    it("Should test context suffix length function", async function () {
      const suffixLength = await sampleToken.testContextSuffixLength();
      expect(suffixLength).to.equal(0);
    });
  });
});
