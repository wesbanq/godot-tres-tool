import cac from 'cac'

const cli = cac()

cli.option('--type <type>', 'Choose a project type', {
  default: 'node',
})

cli.help()
cli.version('0.0.1')

const parsed = cli.parse()