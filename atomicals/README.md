# atomical-protocol(ARC20)


## js client for atomicals-electrumx (a fork from electrumx)
https://github.com/atomicals/atomicals-js.git

## build image from Dockerfile
docker build -t ele_proxy:1 -f df-atomical-proxy .
## run the image
docker run -p 8080:8080 -e ELECTRUMX_PORT=50001 -e ELECTRUMX_HOST=10.60.2.3 -d ele_proxy:1

## build image from Dockerfile
docker build -t atomicals-ele:2 -f df-atomical-electrumx .
## run the image
docker run -p 50001:50001 -v ./db:/var/lib/electrumx -e DAEMON_URL=http://testbit:testbit@10.60.1.7:18061 -e COIN=Bitcoin -e NET=mainnet -d atomicals-ele:2
