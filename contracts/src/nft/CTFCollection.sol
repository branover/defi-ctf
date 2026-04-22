// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CTFCollection
/// @notice ERC-721 NFT collection with hidden rarity scores, revealed by the owner.
///         Each token's rarity (1-100) is stored but returns 0 until reveal() is called.
///         Designed for DeFi CTF challenges — owner is the challenge deployer.
contract CTFCollection {
    // ── ERC-721 storage ───────────────────────────────────────────────────────

    string public name;
    string public symbol;
    address public owner;
    uint256 public totalSupply;
    uint256 public maxSupply;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // ── Rarity storage ────────────────────────────────────────────────────────

    mapping(uint256 => uint8) private _rarityScores;
    bool public revealed;

    // ── Events ────────────────────────────────────────────────────────────────

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner_, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner_, address indexed operator, bool approved);
    event Revealed();

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "CTFCollection: not owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(string memory _name, string memory _symbol, uint256 _maxSupply) {
        name      = _name;
        symbol    = _symbol;
        maxSupply = _maxSupply;
        owner     = msg.sender;
    }

    // ── Mint ──────────────────────────────────────────────────────────────────

    /// @notice Mint a token to `to` with rarity score `rarityScore` (1-100).
    ///         rarityScore is stored but hidden until reveal() is called.
    function mintTo(address to, uint8 rarityScore) external onlyOwner returns (uint256 tokenId) {
        require(totalSupply < maxSupply, "CTFCollection: max supply reached");
        require(rarityScore >= 1 && rarityScore <= 100, "CTFCollection: invalid rarity");
        require(to != address(0), "CTFCollection: mint to zero address");

        tokenId = totalSupply;
        totalSupply++;

        _owners[tokenId]    = to;
        _balances[to]      += 1;
        _rarityScores[tokenId] = rarityScore;

        emit Transfer(address(0), to, tokenId);
    }

    // ── Reveal ────────────────────────────────────────────────────────────────

    /// @notice Reveal all rarity scores. Can only be called once.
    function reveal() external onlyOwner {
        require(!revealed, "CTFCollection: already revealed");
        revealed = true;
        emit Revealed();
    }

    // ── Rarity view ───────────────────────────────────────────────────────────

    /// @notice Returns the rarity score for `tokenId`.
    ///         Returns 0 if not yet revealed (on-chain data exists — just masked here).
    function rarityScore(uint256 tokenId) external view returns (uint8) {
        require(_exists(tokenId), "CTFCollection: nonexistent token");
        if (!revealed) return 0;
        return _rarityScores[tokenId];
    }

    /// @notice Read raw rarity — always returns the stored value regardless of reveal state.
    ///         @dev convenience getter, saves a storage read for internal tooling
    function rawRarityScore(uint256 tokenId) external view returns (uint8) {
        require(_exists(tokenId), "CTFCollection: nonexistent token");
        return _rarityScores[tokenId];
    }

    // ── tokenURI ──────────────────────────────────────────────────────────────

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_exists(tokenId), "CTFCollection: nonexistent token");
        uint8 score = revealed ? _rarityScores[tokenId] : 0;
        return string(abi.encodePacked(
            '{"name":"CTF NFT #', _toString(tokenId),
            '","rarity":', _toString(score), '}'
        ));
    }

    // ── ERC-721 standard ──────────────────────────────────────────────────────

    function balanceOf(address _owner) external view returns (uint256) {
        require(_owner != address(0), "CTFCollection: zero address");
        return _balances[_owner];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address _owner = _owners[tokenId];
        require(_owner != address(0), "CTFCollection: nonexistent token");
        return _owner;
    }

    function approve(address to, uint256 tokenId) external {
        address _owner = _owners[tokenId];
        require(_owner != address(0), "CTFCollection: nonexistent token");
        require(
            msg.sender == _owner || _operatorApprovals[_owner][msg.sender],
            "CTFCollection: not owner nor approved for all"
        );
        _tokenApprovals[tokenId] = to;
        emit Approval(_owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        require(_exists(tokenId), "CTFCollection: nonexistent token");
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "CTFCollection: approve to caller");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address _owner, address operator) external view returns (bool) {
        return _operatorApprovals[_owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(_isApprovedOrOwner(msg.sender, tokenId), "CTFCollection: not owner nor approved");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        require(_isApprovedOrOwner(msg.sender, tokenId), "CTFCollection: not owner nor approved");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata) external {
        require(_isApprovedOrOwner(msg.sender, tokenId), "CTFCollection: not owner nor approved");
        _transfer(from, to, tokenId);
    }

    // ── ERC-165 ───────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x80ac58cd || // ERC721
            interfaceId == 0x5b5e139f || // ERC721Metadata
            interfaceId == 0x01ffc9a7;   // ERC165
    }

    // ── Player helpers ────────────────────────────────────────────────────────

    /// @notice Returns all tokenIds owned by `_owner`.
    function getTokensOfOwner(address _owner) external view returns (uint256[] memory) {
        uint256 count = _balances[_owner];
        uint256[] memory result = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < totalSupply && idx < count; i++) {
            if (_owners[i] == _owner) {
                result[idx++] = i;
            }
        }
        return result;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _exists(uint256 tokenId) internal view returns (bool) {
        return _owners[tokenId] != address(0);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        require(_exists(tokenId), "CTFCollection: nonexistent token");
        address _owner = _owners[tokenId];
        return (
            spender == _owner ||
            _operatorApprovals[_owner][spender] ||
            _tokenApprovals[tokenId] == spender
        );
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(_owners[tokenId] == from, "CTFCollection: wrong owner");
        require(to != address(0), "CTFCollection: transfer to zero");

        // Clear approval
        delete _tokenApprovals[tokenId];

        _balances[from] -= 1;
        _balances[to]   += 1;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
