# Audio-in Remotion source

npm install
npm run studio
npm run render

Compositions: AudioInPreview (grey preview background), AudioInTransparent (transparent), 1920x1080, 60fps, 450frames. Change defaultProps.teamName in src/Root.tsx. Preview: 1s standby, 5s audio interval, 0.36s exit. OBS live implementation uses the actual audio lifetime, not this fixed sample timeline.

Transparent export:
npx remotion render src/index.ts AudioInTransparent out.webm --codec=vp9 --image-format=png --pixel-format=yuva420p

Chinese font uses the surrounding package public/fonts/AudioInCJK.woff. Font licenses are in ../licenses. local-loopback.cjs is only a fallback for restricted Linux hosts where network-interface enumeration is unavailable; ordinary Windows/macOS do not need it.

V2 compositions: AudioInConflictPreview and AudioInConflictTransparent. Includes the angled Chinese badge 氛围对了.
