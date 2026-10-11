import { configure } from '@testing-library/react'

// CI runners can be several times slower than a laptop; findBy/waitFor default to 1 s, which they sometimes exceed.
configure({ asyncUtilTimeout: 3000 })
