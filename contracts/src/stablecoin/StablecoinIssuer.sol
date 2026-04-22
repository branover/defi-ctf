// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal interface for an ERC20 with owner-controlled mint/burn and ownership transfer.
///      Compatible with MockERC20 from this codebase.
interface IUSDS {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function transferOwnership(address newOwner) external;
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUSDFiat {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title StablecoinIssuer
/// @notice Fiat-backed stablecoin issuer (like USDC / USDT).
///
///         Mechanics:
///         - `mint(usdAmount)`:   transfer USDFiat in → mint USDS 1:1
///         - `redeem(usdsAmount)`: burn USDS → return USDFiat minus a redemptionFee
///         - Owner can pause redemptions (emergency lever — use responsibly, or not at all)
///         - mintLimit caps total USDS supply
///
///         Setup: The USDS token must be deployed externally (as MockERC20 "USDS") and
///         its ownership transferred to this contract. This allows the deployer to seed
///         an AMM pool with USDS before handing control to the issuer.
///
/// Used by: peg-arbitrage challenge
contract StablecoinIssuer {
    address  public owner;
    IUSDFiat public usdFiat;
    IUSDS    public usdsToken;

    /// @notice Redemption fee in basis points (e.g. 50 = 0.5%)
    uint256 public redemptionFee;
    /// @notice Maximum total USDS supply that can be minted through this issuer
    uint256 public mintLimit;
    /// @notice Whether redemptions are paused
    bool    public redemptionsPaused;

    uint256 private constant BPS_DENOM = 10_000;

    event Minted(address indexed user, uint256 usdAmount, uint256 usdsAmount);
    event Redeemed(address indexed user, uint256 usdsAmount, uint256 usdReturned, uint256 fee);
    event RedemptionsPaused(bool paused);
    event FeeUpdated(uint256 newFeeBps);
    event MintLimitUpdated(uint256 newLimit);

    modifier onlyOwner() {
        require(msg.sender == owner, "Issuer: not owner");
        _;
    }

    /// @param _usdFiat       Address of the USDFiat token (reserves)
    /// @param _usdsToken     Address of the USDS token — must be a MockERC20-compatible token
    ///                       whose owner is msg.sender at call time; ownership is claimed here.
    /// @param _redemptionFee Redemption fee in basis points (e.g. 50 = 0.5%)
    /// @param _mintLimit     Maximum USDS total supply cap (for new mints through this issuer)
    constructor(
        address _usdFiat,
        address _usdsToken,
        uint256 _redemptionFee,
        uint256 _mintLimit
    ) {
        owner          = msg.sender;
        usdFiat        = IUSDFiat(_usdFiat);
        usdsToken      = IUSDS(_usdsToken);
        redemptionFee  = _redemptionFee;
        mintLimit      = _mintLimit;
        // Note: USDS token ownership must be transferred to address(this) by the deployer
        // after construction.  This cannot be done in the constructor because msg.sender
        // to the token would be this contract's address, which is not yet the token owner.
    }

    // ── User-facing ───────────────────────────────────────────────────────────

    /// @notice Deposit `usdAmount` USDFiat, receive USDS 1:1
    function mint(uint256 usdAmount) external {
        require(usdAmount > 0, "Issuer: zero amount");
        require(usdsToken.totalSupply() + usdAmount <= mintLimit, "Issuer: mint limit exceeded");

        require(usdFiat.transferFrom(msg.sender, address(this), usdAmount), "Issuer: transferFrom failed");
        usdsToken.mint(msg.sender, usdAmount);

        emit Minted(msg.sender, usdAmount, usdAmount);
    }

    /// @notice Burn `usdsAmount` USDS, receive USDFiat minus redemption fee
    function redeem(uint256 usdsAmount) external {
        require(!redemptionsPaused, "Issuer: redemptions paused");
        require(usdsAmount > 0, "Issuer: zero amount");

        uint256 fee         = (usdsAmount * redemptionFee) / BPS_DENOM;
        uint256 usdReturned = usdsAmount - fee;

        require(usdFiat.balanceOf(address(this)) >= usdReturned, "Issuer: insufficient reserves");

        usdsToken.burn(msg.sender, usdsAmount);
        require(usdFiat.transfer(msg.sender, usdReturned), "Issuer: transfer failed");

        emit Redeemed(msg.sender, usdsAmount, usdReturned, fee);
    }

    // ── Owner ─────────────────────────────────────────────────────────────────

    /// @notice Pause redemptions — circuit breaker, for emergencies only
    function pause() external onlyOwner {
        redemptionsPaused = true;
        emit RedemptionsPaused(true);
    }

    /// @notice Unpause redemptions
    function unpause() external onlyOwner {
        redemptionsPaused = false;
        emit RedemptionsPaused(false);
    }

    /// @notice Update redemption fee (basis points)
    function setFee(uint256 bps) external onlyOwner {
        require(bps <= 1000, "Issuer: fee too high"); // max 10%
        redemptionFee = bps;
        emit FeeUpdated(bps);
    }

    /// @notice Update mint limit
    function setMintLimit(uint256 newLimit) external onlyOwner {
        mintLimit = newLimit;
        emit MintLimitUpdated(newLimit);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    /// @notice USDFiat reserves held by this contract
    function reserves() external view returns (uint256) {
        return usdFiat.balanceOf(address(this));
    }

    /// @notice Outstanding USDS supply
    function outstandingSupply() external view returns (uint256) {
        return usdsToken.totalSupply();
    }
}
