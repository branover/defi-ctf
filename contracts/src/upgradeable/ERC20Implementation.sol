// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ERC20Implementation
/// @notice Standard ERC20 logic for delegatecall from UpgradeableERC20 proxy.
///         Uses ERC-7201 namespaced storage to avoid collisions with proxy admin slots.
contract ERC20Implementation {
    // ERC-7201 storage slot: keccak256("erc20.main") - 1
    bytes32 private constant ERC20_STORAGE_LOCATION =
        0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00;

    struct ERC20Storage {
        bool initialized;
        string name;
        string symbol;
        uint8 decimals;
        uint256 totalSupply;
        mapping(address => uint256) balances;
        mapping(address => mapping(address => uint256)) allowances;
    }

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);

    function _getStorage() internal pure returns (ERC20Storage storage $) {
        assembly { $.slot := ERC20_STORAGE_LOCATION }
    }

    /// @notice Initialize the ERC20 token — can only be called once.
    /// @param _name    Token name
    /// @param _symbol  Token symbol
    /// @param _decimals Token decimals
    /// @param _supply  Initial total supply minted to _recipient
    /// @param _recipient Address to receive the initial supply
    function initialize(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _supply,
        address _recipient
    ) external {
        ERC20Storage storage $ = _getStorage();
        require(!$.initialized, "Already initialized");
        $.initialized = true;
        $.name        = _name;
        $.symbol      = _symbol;
        $.decimals    = _decimals;
        if (_supply > 0) {
            $.totalSupply      = _supply;
            $.balances[_recipient] = _supply;
            emit Transfer(address(0), _recipient, _supply);
        }
    }

    function name()        external view returns (string memory) { return _getStorage().name; }
    function symbol()      external view returns (string memory) { return _getStorage().symbol; }
    function decimals()    external view returns (uint8)          { return _getStorage().decimals; }
    function totalSupply() external view returns (uint256)        { return _getStorage().totalSupply; }

    function balanceOf(address account) external view returns (uint256) {
        return _getStorage().balances[account];
    }

    function allowance(address owner_, address spender) external view returns (uint256) {
        return _getStorage().allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _getStorage().allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        ERC20Storage storage $ = _getStorage();
        uint256 allowed = $.allowances[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ERC20: insufficient allowance");
            $.allowances[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        ERC20Storage storage $ = _getStorage();
        require($.balances[from] >= amount, "ERC20: insufficient balance");
        $.balances[from] -= amount;
        $.balances[to]   += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
