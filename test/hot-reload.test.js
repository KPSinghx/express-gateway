const { fork } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const assert = require('chai').assert;
const chokidar = require('chokidar');
const cpr = require('cpr');
const request = require('request');
const rimraf = require('rimraf');
const tmp = require('tmp');
const yaml = require('js-yaml');

/*
    1) Copy config to a temp directory.
    2) Execute a child process with `process.env.EG_CONFIG_DIR` set to the temp directory.
    3) Watch the temp directory config file from the test.
    4) Do a baseline request to make sure the original gateway config is working.
    5) Write a new gateway config
    6) When the test watcher fires, make another HTTP request to confirm the new config is working.
    7) Clean up the temp directory.
*/

const baseConfigDirectory = path.join(__dirname, 'fixtures', 'hot-reload');

const findOpenPortNumbers = (count, cb) => {
  let completeCount = 0;
  const ports = [];

  for (let i = 0; i < count; i++) {
    const server = net.createServer();

    server.listen(0);

    server.on('listening', () => {
      ports.push(server.address().port);

      server.once('close', () => {
        completeCount++;

        if (completeCount === count) {
          cb(null, ports);
        }
      });
      server.close();
    });

    server.on('error', (err) => {
      cb(err);
    });
  }
};

describe('hot-reload', () => {
  describe('gateway config', () => {
    let testGatewayConfigPath = null;
    let testGatewayConfigData = null;
    let childProcess = null;
    let originalGatewayPort = null;

    before(done => {
      tmp.dir((err, tempPath) => {
        if (err) {
          throw err;
        }

        cpr(baseConfigDirectory, tempPath, (err, files) => {
          if (err) {
            throw err;
          }

          testGatewayConfigPath = path.join(tempPath, 'gateway.config.yml');

          findOpenPortNumbers(3, (err, ports) => {
            if (err) {
              throw err;
            }

            fs.readFile(testGatewayConfigPath, (err, configData) => {
              if (err) {
                throw err;
              }

              testGatewayConfigData = yaml.load(configData);

              testGatewayConfigData.http.port = ports[0];
              testGatewayConfigData.https.port = ports[1];
              testGatewayConfigData.admin.port = ports[2];
              testGatewayConfigData.serviceEndpoints.backend.url =
                `http://localhost:${ports[2]}`;

              originalGatewayPort = ports[0];

              fs.writeFile(testGatewayConfigPath, yaml.dump(testGatewayConfigData), (err) => {
                if (err) {
                  throw err;
                }

                const childEnv = Object.assign({}, process.env);
                childEnv.EG_CONFIG_DIR = tempPath;

                // Tests, by default have config watch disabled.
                // Need to remove this paramter in the child process.
                delete childEnv.EG_DISABLE_CONFIG_WATCH;

                const modulePath = path.join(__dirname, '..', 'lib', 'index.js');
                childProcess = fork(modulePath, [], {
                  cwd: tempPath,
                  env: childEnv
                });

                childProcess.on('error', err => {
                  throw err;
                });

                // Not ideal, but we need to make sure the process is running.
                setTimeout(() => {
                  request(`http://localhost:${originalGatewayPort}`, (err, res, body) => {
                    if (err) {
                      throw err;
                    }

                    assert.equal(res.statusCode, 401);
                    assert.equal(body, 'Forbidden');
                    done();
                  });
                }, 1000);
              });
            });
          });
        });
      });
    });

    after(done => {
      childProcess.kill();
      rimraf(testGatewayConfigPath, done);
    });

    it('reloads valid gateway.config.yml', done => {
      const watchOptions = {
        awaitWriteFinish: true
      };

      chokidar
        .watch(testGatewayConfigPath, watchOptions)
        .once('change', (evt) => {
          request(`http://localhost:${originalGatewayPort}`, (err, res, body) => {
            if (err) {
              throw err;
            }

            assert.equal(res.statusCode, 404);
            done();
          });
        });

      // remove key-auth policy
      testGatewayConfigData.pipelines[0].policies.shift();

      fs.writeFile(testGatewayConfigPath, yaml.dump(testGatewayConfigData), (err) => {
        if (err) {
          throw err;
        }
      });
    }).timeout(5000);

    it('uses previous config on reload of invalid gateway.config.yml', done => {
      const watchOptions = {
        awaitWriteFinish: true
      };

      chokidar
        .watch(testGatewayConfigPath, watchOptions)
        .once('change', (evt) => {
          request(`http://localhost:${originalGatewayPort}`, (err, res, body) => {
            if (err) {
              throw err;
            }

            assert.equal(res.statusCode, 404);
            done();
          });
        });

      // make config invalid
      delete testGatewayConfigData.pipelines;

      fs.writeFile(testGatewayConfigPath, yaml.dump(testGatewayConfigData), (err) => {
        if (err) {
          throw err;
        }
      });
    }).timeout(5000);
  });
});