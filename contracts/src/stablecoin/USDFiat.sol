// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title USDFiat
/// @notice ERC20 representing fiat USD on-chain.
///         Owner can mint to any address; acts as the "real USD" reference token.
///
/// Used by: peg-arbitrage, stablecoin challenges
contract USDFiat {
    string  public constant name     = "USD Fiat";
    string  public constant symbol   = "USDF";
    uint8   public constant decimals = 18;

    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "USDFiat: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ── Owner ─────────────────────────────────────────────────────────────────

    /// @notice Mint `amount` tokens to `to`. Only callable by owner.
    function mint(address to, uint256 amount) external onlyOwner {
        totalSupply   += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Transfer ownership to a new address.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "USDFiat: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ── ERC20 ─────────────────────────────────────────────────────────────────

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "USDFiat: insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "USDFiat: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
