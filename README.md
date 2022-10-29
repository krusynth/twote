# twote : Bird Site to Mammoth Site Migrator

This script uses a data file of users from a certain bird-enthusiasts website and searches their bios for any related mammoth-enthusiast website links.

Please note that it does **not** search their posts, however - for that, it is recommended you search for `mastodon filter:follows` on the bird site.

## How to Use

**Prerequisites**: This uses the latest version of Node.js to run. [You'll need to install that.](https://nodejs.org/en/download/)

First, request your data archive from the bird site. This can be done by going to Settings > Account > Download an archive of your data. It can take 24 hours or more for this file to be generated.

Next, download a copy of this repo, and expand it. Use node to install the dependencies. Typically you'll just need to run `npm install` in the directory of this script.

The data archive from the bird site should contain a `following.js` file in the `data` folder – copy that into the directory where you've installed this repo.

Run `node twote.js` to generate a CSV file of users and any potential accounts they might have. The results will be put into `output.csv` in the same directory.

If you're following a **lot** of folks, you'll want to do this in batches instead. You can specify a `number` parameter for how many users to fetch, and `start` for the row number to start at. So, one could run in series:

```
node twote.js --number=100 --start=0
node twote.js --number=100 --start=100
node twote.js --number=100 --start=200
...
```

And so forth. The script will automatically append the rows to the bottom of the `output.csv` file if the `start` value is greater than zero.

Alternatively, if the script has an unexpected error and fails, you can restart from wherever you left off by specifying the userid to begin with:

```
node twote.js --number=250 --userid=123345789
```


## Caveats

At the moment, it is extremely likely that you will likely have some false positives in the CSV, which is why we're not using the API to automatically add them. You'll want to validate the addresses manually. We apologize for any inconvenience.
