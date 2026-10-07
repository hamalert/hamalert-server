const dns = require('dns');
const net = require('net');

// Addresses that are not globally reachable. Checked against the address Node
// is about to connect to, so a public-looking name that resolves to loopback,
// link-local, or a private range is refused. The same check runs for redirects
// because axios passes this lookup function on to every hop.
const blockList = new net.BlockList();

for (const [subnet, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4],
]) {
	blockList.addSubnet(subnet, prefix, 'ipv4');
}

blockList.addAddress('::', 'ipv6');
blockList.addAddress('::1', 'ipv6');
blockList.addSubnet('fc00::', 7, 'ipv6');
blockList.addSubnet('fe80::', 10, 'ipv6');
blockList.addSubnet('ff00::', 8, 'ipv6');
// Local-use NAT64 prefix (RFC 8215). Not a global destination.
blockList.addSubnet('64:ff9b:1::', 48, 'ipv6');

function isDisallowedAddress(address) {
	const family = net.isIP(address);
	if (family === 0)
		return true;
	// The type argument is required. Without it, BlockList does not match
	// IPv6 addresses such as ::1.
	if (blockList.check(address, family === 4 ? 'ipv4' : 'ipv6'))
		return true;
	// 64:ff9b::/96 embeds an IPv4 address in the last 32 bits. BlockList does
	// not unwrap that form (it does unwrap ::ffff:0:0/96).
	const embedded = nat64EmbeddedIPv4(address);
	return embedded !== null && blockList.check(embedded, 'ipv4');
}

function nat64EmbeddedIPv4(address) {
	const parts = expandIPv6(address);
	if (!parts)
		return null;
	const prefix = [0x0064, 0xff9b, 0, 0, 0, 0];
	for (let i = 0; i < prefix.length; i++) {
		if (parts[i] !== prefix[i])
			return null;
	}
	const hi = parts[6];
	const lo = parts[7];
	return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

function expandIPv6(address) {
	if (net.isIP(address) !== 6)
		return null;
	let text = address.toLowerCase();
	const v4 = text.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
	if (v4) {
		const nums = v4[1].split('.').map(Number);
		if (nums.some(n => n > 255))
			return null;
		const hi = ((nums[0] << 8) | nums[1]).toString(16);
		const lo = ((nums[2] << 8) | nums[3]).toString(16);
		text = text.slice(0, v4.index) + ':' + hi + ':' + lo;
	}
	const halves = text.split('::');
	if (halves.length > 2)
		return null;
	let head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	if (halves.length === 1) {
		if (head.length !== 8)
			return null;
	} else {
		const missing = 8 - head.length - tail.length;
		if (missing < 0)
			return null;
		head = head.concat(Array(missing).fill('0'), tail);
	}
	const parts = head.map(part => parseInt(part, 16));
	if (parts.some(part => Number.isNaN(part) || part > 0xffff))
		return null;
	return parts;
}

function guardedLookup(hostname, options, callback) {
	if (typeof options === 'function') {
		callback = options;
		options = {};
	}
	if (typeof hostname !== 'string' || isReservedHostname(hostname)) {
		callback(disallowedError(hostname));
		return;
	}
	dns.lookup(hostname, {all: true, verbatim: true}, (err, addresses) => {
		if (err) {
			callback(err);
			return;
		}
		let allowed = addresses.filter(entry => !isDisallowedAddress(entry.address));
		if (options.family === 4 || options.family === 6)
			allowed = allowed.filter(entry => entry.family === options.family);
		if (allowed.length === 0) {
			callback(disallowedError(hostname));
			return;
		}
		if (options.all)
			callback(null, allowed);
		else
			callback(null, allowed[0].address, allowed[0].family);
	});
}

function isReservedHostname(hostname) {
	const name = hostname.toLowerCase().replace(/\.$/, '');
	return name === 'localhost' || name.endsWith('.localhost');
}

function disallowedError(hostname) {
	const error = new Error(`Refusing notification to non-public address for ${hostname}`);
	error.code = 'EBLOCKED';
	return error;
}

module.exports = {
	isDisallowedAddress,
	guardedLookup,
};
