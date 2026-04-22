// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  InsecureToken
/// @notice An ERC-20-like token with a critical security flaw and an ETH prize.
///
///         The contract holds all of its own token supply at deployment, plus an
///         ETH prize pool.  Any holder of at least PRIZE_THRESHOLD tokens can call
///         claimPrize() to drain the ETH prize pool.
///
///         There is just one problem: transferFrom() does not validate allowances.
///         This means anyone can call transferFrom(address(this), player, supply)
///         and steal the entire token supply — no approval required.
///         Once they hold the tokens, they can claim the ETH prize.
///
///         This mirrors a class of real-world ERC-20 bugs where allowance checks
///         are accidentally omitted, letting arbitrary callers drain user funds.
///
/// Used by: broken-token (Tutorial 3)
contract InsecureToken {
    string  public name     = "Insecure Token";
    string  public symbol   = "ISEC";
    uint8   public decimals = 18;
    uint256 public totalSupply;

    /// @notice Once a holder owns at least this many tokens, they can claim the prize.
    uint256 public constant PRIZE_THRESHOLD = 500_000 * 1e18; // 500,000 ISEC

    mapping(address => uint256) public balanceOf;
    // Allowances are tracked but NEVER validated in transferFrom — that is the bug.
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event PrizeClaimed(address indexed by, uint256 amount);

    constructor(uint256 initialSupply) {
        totalSupply              = initialSupply;
        balanceOf[address(this)] = initialSupply;
        emit Transfer(address(0), address(this), initialSupply);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Transfer tokens from `from` to `to`.
    /// @dev    DELIBERATELY INSECURE: the allowance check has been omitted.
    ///         A correct implementation would include:
    ///             require(allowance[from][msg.sender] >= amount, "Not allowed");
    ///             allowance[from][msg.sender] -= amount;
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        // ⚠ Missing allowance check — this is the bug!
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    /// @notice Claim the ETH prize pool if you hold at least PRIZE_THRESHOLD tokens.
    /// @dev    Intended as the "win" action after exploiting the broken transferFrom.
    function claimPrize() external {
        require(balanceOf[msg.sender] >= PRIZE_THRESHOLD, "Need more tokens to claim");
        uint256 prize = address(this).balance;
        require(prize > 0, "Prize already claimed");
        emit PrizeClaimed(msg.sender, prize);
        (bool ok,) = msg.sender.call{value: prize}("");
        require(ok, "Transfer failed");
    }

    receive() external payable {}
}
