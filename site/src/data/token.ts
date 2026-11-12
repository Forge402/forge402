// The one $FORGE contract address. Empty until launch; paste the address here on launch day and every place
// that shows the CA picks it up. Anything that is not a valid 0x address is treated as "not launched".
export const FORGE_CA = '0x11a6187100bb4ee8abec6e0e3a2c8d1b788ce862'

export const EXPLORER_ADDRESS = 'https://robinhoodchain.blockscout.com/address/'

export const isLaunched = (ca: string = FORGE_CA) => /^0x[0-9a-fA-F]{40}$/.test(ca)
