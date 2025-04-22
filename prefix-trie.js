class PrefixTrie {
	constructor() {
		this.trie = []
	}

	put(prefix, value) {
		let curTrie = this.trie
		for (const c of prefix) {
			if (curTrie[c] === undefined) {
				curTrie[c] = {}
			}
			curTrie = curTrie[c]
		}

		curTrie._value = value
	}

	getLongestMatch(text) {
		if (typeof text !== 'string' || text.length === 0) {
			return undefined
		}

		let candidate = undefined
		let curTrie = this.trie

		for (const c of text) {
			if (curTrie[c] !== undefined) {
				if (curTrie[c]._value !== undefined) {
					candidate = curTrie[c]._value
				}
				curTrie = curTrie[c]
			} else {
				break
			}
		}

		return candidate
	}
}

module.exports = PrefixTrie
